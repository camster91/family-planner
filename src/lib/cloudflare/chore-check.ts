/** Parent account/profile verification translated to native atomic D1 batches.
 * Source reads are optimistic witnesses, never an ignored interactive lock.
 * The person/device completion protocols remain separate from this parent action. */
import { randomUUID } from "node:crypto";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { prepareD1ChoreCheckNotification } from "./chore-check-notifications";
import {
  choreCheckCommandsEnabled,
  choreCheckCommandSchema,
  choreCheckOwnerMatches,
} from "@/lib/chore-check-command";
import {
  choreCheckSnapshot,
  sameChoreCheckSnapshot,
  type ChoreCheckCommand,
} from "@/lib/chore-check-command-shared";
import { choreCheckNotificationDispatchWindow } from "@/lib/chore-check-notification-event";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { readChoreSubject } from "@/lib/chore-profile";
import { isProfileChoreRecurrenceSupported } from "@/lib/profile-chore-gates";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
import {
  nextStreak,
  levelForXp,
  type AwardChoreXPResult,
} from "@/lib/gamification-server";
import { calculateChoreXP } from "@/lib/gamification";
import { notificationDeliveryDecision } from "@/lib/notification-delivery-policy";
import { QUIET_HOURS_SELECT } from "@/lib/quiet-hours";
import type { EffectResult } from "@/lib/idempotency";
import type { D1ChoreStateActor } from "./chore-state";

type Command = {
  choreId: string;
  decision: "approve" | "reject";
  verificationNotes?: string;
  original?: ChoreCheckCommand | null;
};
type CheckEffect = {
  profile: boolean;
  decision: "approve" | "reject";
  at: Date;
  notifiedInTx: boolean;
  assignee: { id: string; title: string; familyId: string } | null;
  xp: AwardChoreXPResult | null;
};
export type D1ChoreCheckResult = EffectResult & { effect?: CheckEffect };
const reply = (status: number, body: unknown): D1ChoreCheckResult => ({
  status,
  body,
});
function state(row: {
  id: string;
  status: string;
  photo_verified: boolean;
  verified_at: Date | null;
  verified_notes: string | null;
  completed_at: Date | null;
}) {
  return {
    id: row.id,
    status: row.status,
    photo_verified: row.photo_verified,
    verified_at: row.verified_at,
    verified_notes: row.verified_notes,
    completed_at: row.completed_at,
  };
}
export async function checkD1Chore(
  actor: D1ChoreStateActor,
  command: Command,
  options: { database?: D1Store; now?: Date; clock?: () => Date } = {},
): Promise<D1ChoreCheckResult> {
  const store = options.database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const clock = options.clock ?? (() => new Date()),
    now = options.now ?? clock(),
    notes = command.verificationNotes || null;
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid chore check clock");
  const original = command.original ?? null,
    windowMs = choreCheckNotificationDispatchWindow(),
    strong = windowMs !== null || original !== null;
  if (
    original &&
    (!choreCheckCommandsEnabled() ||
      !choreCheckCommandSchema.safeParse(original).success)
  )
    return reply(503, {
      error: "Chore checking is unavailable",
      code: "CHORE_CHECK_UNAVAILABLE",
    });
  if (
    original &&
    (!choreCheckOwnerMatches(original.owner, {
      ...actor,
      tokenVersion: actor.generation,
    }) ||
      original.choreId !== command.choreId ||
      original.decision !== command.decision ||
      (original.verificationNotes || null) !== notes)
  )
    return reply(409, {
      error:
        "Your account or household changed. Review before checking this chore.",
      code: "CHORE_CHECK_OWNER_CHANGED",
    });
  let initial: { status: string; assignee: string | null } | null = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const caller = await db.user.findUnique({
          where: { id: actor.userId },
          select: {
            id: true,
            name: true,
            family_id: true,
            role: true,
            token_version: true,
          },
        });
        if (!caller || caller.token_version !== actor.generation)
          return { response: reply(401, { error: "Unauthorized" }) };
        if (
          caller.family_id !== actor.familyId ||
          caller.role !== "parent" ||
          actor.role !== "parent"
        )
          return {
            response: reply(403, {
              error: "Only parents can perform this action",
            }),
          };
        const family = await db.family.findUnique({
          where: { id: actor.familyId },
          select: { features: true },
        });
        if (
          !family ||
          !isFeatureEnabled(normalizeFeatures(family.features), "chores")
        )
          return {
            response: reply(original ? 503 : 403, {
              error: "Chore checking is unavailable",
              code: "CHORE_CHECK_UNAVAILABLE",
            }),
          };
        const chore = await db.chore.findUnique({
          where: { id: command.choreId },
        });
        if (!chore || (original && chore.family_id !== actor.familyId))
          return { response: reply(404, { error: "Chore not found" }) };
        if (chore.family_id !== actor.familyId)
          return { response: reply(403, { error: "Forbidden" }) };
        initial ??= { status: chore.status, assignee: chore.assigned_to };
        if (original) {
          const snapshot = choreCheckSnapshot(chore);
          if (!snapshot || !sameChoreCheckSnapshot(snapshot, original.expected))
            return {
              response: reply(409, {
                error:
                  "This chore changed since your review. Check its current state before trying again.",
                code: "CHORE_CHECK_CHANGED",
              }),
            };
        }
        if (strong && chore.assigned_to !== initial.assignee)
          return {
            response: reply(409, {
              error:
                "This chore changed. Review its current assignment before checking it.",
              code: "CHORE_CHANGED",
              chore: state(chore),
            }),
          };
        if (chore.status === "verified")
          return {
            response:
              command.decision === "approve"
                ? reply(200, {
                    success: true,
                    alreadyVerified: true,
                    chore: state(chore),
                  })
                : reply(409, {
                    error:
                      "This chore has already been checked, so it stays done.",
                    code: "CHORE_ALREADY_VERIFIED",
                  }),
          };
        if (command.decision === "approve" && chore.status !== "completed")
          return {
            response: ["completed", "verified"].includes(initial.status)
              ? reply(409, {
                  error:
                    "This chore changed while you were checking it and is no longer waiting to be checked.",
                  code: "CHORE_NOT_COMPLETED",
                  chore: state(chore),
                })
              : reply(400, { error: "Only completed chores can be verified" }),
          };
        let profile: { memberId: string; name: string } | null = null;
        const isProfile =
          chore.assigned_to === null && chore.assigned_member_id !== null;
        if (isProfile) {
          const member = await db.householdMember.findFirst({
            where: { id: chore.assigned_member_id!, family_id: actor.familyId },
            select: {
              id: true,
              family_id: true,
              name: true,
              role: true,
              age: true,
              archived_at: true,
              erasure_user_id: true,
            },
          });
          const mapping = await db.householdMemberLegacyMapping.findFirst({
            where: { member_id: chore.assigned_member_id! },
            select: { user_id: true },
          });
          const link = await db.householdMemberAccountLink.findFirst({
            where: { member_id: chore.assigned_member_id! },
            select: { user_id: true },
          });
          const root = chore.recurrence_id
            ? await db.chore.findFirst({
                where: { id: chore.recurrence_id, family_id: actor.familyId },
                select: {
                  id: true,
                  recurrence_id: true,
                  routine_series_config: true,
                },
              })
            : null;
          const policyRow: RoutineOccurrenceSnapshot = {
            ...chore,
            own_config: chore.routine_series_config,
            root_id: root?.id ?? null,
            root_recurrence_id: root?.recurrence_id ?? null,
            series_config: root?.routine_series_config ?? null,
          };
          const policy = routineOccurrencePolicy(policyRow);
          const subject = readChoreSubject(
            {
              ...chore,
              assignee: null,
              assigneeMember: member
                ? { ...member, legacy_mapping: mapping, account_link: link }
                : null,
            },
            actor.familyId,
          );
          if (
            !member ||
            member.archived_at !== null ||
            !subject ||
            subject.kind !== "profile" ||
            ["inactive", "unsupported"].includes(policy) ||
            (chore.recurrence_id !== null &&
              policy !== "scheduled-once" &&
              !isProfileChoreRecurrenceSupported())
          )
            return {
              response: reply(409, {
                error:
                  "This profile chore is no longer available for verification.",
                code: "MEMBER_PROTOCOL_UNAVAILABLE",
              }),
            };
          profile = subject;
        }
        if (command.decision === "reject" && chore.status !== "completed")
          return {
            response: reply(200, {
              success: true,
              alreadyOpen: true,
              chore: state(chore),
            }),
          };
        const reads = db as unknown as ChoreAssigneeReadDb;
        let assigneeId: string | null = null;
        if (
          !isProfile &&
          !chore.member_subject_erased &&
          chore.assigned_to !== null
        ) {
          const resolved = await eligibleChoreAssigneeFromReads(
            reads,
            actor.familyId,
            chore.assigned_to,
            { requireCanonical: Boolean(chore.assigned_member_id) },
          );
          if (
            chore.assigned_member_id &&
            resolved?.assigned_member_id !== chore.assigned_member_id
          ) {
            if (resolved) throw new HouseholdMemberIdentityConflict();
          } else if (resolved) assigneeId = resolved.assigned_to;
        }
        const assignee = assigneeId
          ? await db.user.findUnique({
              where: { id: assigneeId },
              select: {
                id: true,
                name: true,
                family_id: true,
                xp: true,
                level: true,
                streak: true,
                best_streak: true,
                last_chore_date: true,
                notify_chores: true,
                ...QUIET_HOURS_SELECT,
              },
            })
          : null;
        // Account send-back hands departed work to the checking parent, using
        // the same canonical mapping rule as reopenCompletedChoreInTx.
        let replacementMember: string | null = chore.assigned_member_id;
        if (
          !isProfile &&
          command.decision === "reject" &&
          chore.assigned_member_id
        ) {
          const canonical = await eligibleChoreAssigneeFromReads(
            reads,
            actor.familyId,
            assignee?.id ?? caller.id,
            { requireCanonical: true },
          );
          if (!canonical?.assigned_member_id)
            throw new HouseholdMemberIdentityConflict();
          replacementMember = canonical.assigned_member_id;
        }
        return {
          chore,
          caller,
          profile,
          assignee,
          replacementMember,
          gamification: isFeatureEnabled(
            normalizeFeatures(family.features),
            "gamification",
          ),
        };
      },
      store as unknown as NativeD1,
    );
    if ("response" in captured.value) {
      try {
        await session.batch(captured.checks(session));
        return captured.value.response!;
      } catch (cause) {
        if (!isD1WriteConflict(cause)) throw cause;
        continue;
      }
    }
    const {
      chore,
      caller,
      profile,
      assignee,
      replacementMember,
      gamification,
    } = captured.value;
    const effects: D1Statement[] = [],
      activityId = randomUUID();
    let xp: AwardChoreXPResult | null = null;
    const next = { ...state(chore) };
    if (command.decision === "approve") {
      next.status = "verified";
      next.verified_at = now;
      next.verified_notes = notes;
      if (chore.photo_url) next.photo_verified = true;
      effects.push(
        session
          .prepare(
            `UPDATE "Chore" SET status='verified',verified_at=?1,verified_notes=?2,photo_verified=?3 WHERE id=?4 AND family_id=?5 AND status='completed'`,
          )
          .bind(
            now.getTime(),
            notes,
            Number(next.photo_verified),
            chore.id,
            actor.familyId,
          ),
        d1WriteCheck(session, "changes()=1"),
      );
      if (assignee) {
        const previous = assignee.streak || 0,
          streak = nextStreak(previous, assignee.last_chore_date, now),
          bestStreak = Math.max(streak, assignee.best_streak || 0);
        const xpGained = calculateChoreXP(
            chore.difficulty || "medium",
            previous,
            chore.points || 10,
          ),
          newXp = (assignee.xp || 0) + xpGained,
          oldLevel = assignee.level || 1,
          newLevel = levelForXp(newXp, oldLevel);
        xp = {
          xpGained,
          newXp,
          newLevel,
          levelUp: newLevel > oldLevel,
          streak,
          bestStreak,
        };
        effects.push(
          session
            .prepare(
              `UPDATE "User" SET xp=xp+?1,level=?2,streak=?3,best_streak=?4,last_chore_date=?5 WHERE id=?6 AND family_id=?7`,
            )
            .bind(
              xpGained,
              newLevel,
              streak,
              bestStreak,
              now.getTime(),
              assignee.id,
              actor.familyId,
            ),
          d1WriteCheck(session, "changes()=1"),
        );
      }
    } else {
      next.status = "pending";
      next.completed_at = null;
      next.photo_verified = false;
      next.verified_at = null;
      next.verified_notes = notes;
      effects.push(
        profile
          ? session
              .prepare(
                `UPDATE "Chore" SET status='pending',completed_at=NULL,photo_verified=0,verified_at=NULL,verified_notes=?1 WHERE id=?2 AND family_id=?3 AND status='completed'`,
              )
              .bind(notes, chore.id, actor.familyId)
          : session
              .prepare(
                `UPDATE "Chore" SET status='pending',completed_at=NULL,photo_verified=0,verified_at=NULL,verified_notes=?1,successor_id=NULL,assigned_to=?2,assigned_member_id=?3 WHERE id=?4 AND family_id=?5 AND status='completed'`,
              )
              .bind(
                notes,
                assignee?.id ?? caller.id,
                replacementMember,
                chore.id,
                actor.familyId,
              ),
        d1WriteCheck(session, "changes()=1"),
      );
      if (!profile && chore.successor_id)
        effects.push(
          session
            .prepare(
              `DELETE FROM "Chore" WHERE id=?1 AND family_id=?2 AND status='pending' AND recurrence_id IS NULL`,
            )
            .bind(chore.successor_id, actor.familyId),
        );
    }
    const type =
      command.decision === "approve" ? "chore_verified" : "chore_rejected";
    effects.push(
      session
        .prepare(
          `INSERT INTO "Activity"(id,family_id,user_id,subject_member_id,type,title,description,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
        )
        .bind(
          activityId,
          actor.familyId,
          caller.id,
          profile?.memberId ?? null,
          type,
          `${caller.name} ${command.decision === "approve" ? "verified" : "sent back"} "${chore.title}"`,
          command.decision === "approve" && (profile || assignee)
            ? `Verified ${(profile ?? assignee)!.name}'s chore`
            : null,
          JSON.stringify({
            choreId: chore.id,
            ...(profile ? { subjectMemberId: profile.memberId } : {}),
          }),
          now.getTime(),
        ),
    );
    const notifiedInTx = windowMs !== null && assignee !== null;
    if (assignee && windowMs !== null) {
      if (
        clock().getTime() < now.getTime() ||
        clock().getTime() >= now.getTime() + windowMs
      )
        throw new Error("Chore check notification deadline expired");
      effects.push(
        ...prepareD1ChoreCheckNotification(session, {
          familyId: actor.familyId,
          actorId: caller.id,
          choreId: chore.id,
          generation: chore.responsibility_generation,
          title: chore.title,
          recipientId: assignee.id,
          decision: command.decision,
          notes,
          activityId,
          now,
          windowMs,
          gamification,
          levelUp: xp?.levelUp ? xp.newLevel : null,
          policy: notificationDeliveryDecision(
            {
              notify_chores: assignee.notify_chores,
              quiet_hours_enabled: assignee.quiet_hours_enabled,
              quiet_hours_start: assignee.quiet_hours_start,
              quiet_hours_end: assignee.quiet_hours_end,
              quiet_hours_time_zone: assignee.quiet_hours_time_zone,
            },
            command.decision === "approve" ? "reward" : "chore",
            clock(),
          ),
        }),
      );
    }
    try {
      await session.batch([...captured.checks(session), ...effects]);
      return {
        status: 200,
        body: {
          success: true,
          choreId: chore.id,
          ...(command.decision === "approve"
            ? { gamified: xp !== null }
            : { rejected: true }),
          chore: next,
        },
        effect: {
          profile: !!profile,
          decision: command.decision,
          at: now,
          notifiedInTx,
          xp,
          assignee: assignee
            ? { id: assignee.id, title: chore.title, familyId: actor.familyId }
            : null,
        },
      };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return reply(409, {
    error: "This chore changed. Review its current state before checking it.",
    code: "CHORE_CHANGED",
  });
}
