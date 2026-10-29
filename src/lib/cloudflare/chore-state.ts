import { randomUUID } from "node:crypto";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { isD1WriteConflict, d1WriteCheck } from "./write-check";
import { prepareD1RecurringSeries } from "./recurring-chores";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
  RoutineOccurrenceUnavailableError,
} from "@/lib/routine-occurrence-policy";
import {
  resolveChorePhotoForWrite,
  type ChorePhotoReadDb,
} from "@/lib/chore-photos";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { nextDueDate } from "@/lib/chore-recurrence-dates";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { profileChoreLegacyWriteRefusal } from "@/lib/chore-profile";
import type { EffectResult } from "@/lib/idempotency";
export type D1ChoreStateActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
type Command =
  | { kind: "complete"; choreId: string; photoUrl?: string | null }
  | { kind: "undo"; choreId: string };
export type D1ChoreStateResult = EffectResult & {
  completed: boolean;
  completedAt?: Date;
};
const reply = (status: number, body: unknown): D1ChoreStateResult => ({
  status,
  body,
  completed: false,
});
/** Person-session account actions only. Device/profile commands retain their
 * own credential/subject protocols and must not enter through this API.
 * Completion intentionally allows any current household member (D3); Undo is
 * restricted to parent/assignee. Verification remains the only XP writer.
 */
export async function transitionD1AccountChore(
  actor: D1ChoreStateActor,
  command: Command,
  options: { database?: D1Store; now?: Date } = {},
): Promise<D1ChoreStateResult> {
  const store = options.database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid chore state clock");
  for (let attempt = 0; attempt < 16; attempt++) {
    const capture = await captureD1Reads(
      async (db) => {
        const person = await db.user.findUnique({
          where: { id: actor.userId },
          select: {
            id: true,
            name: true,
            family_id: true,
            role: true,
            token_version: true,
          },
        });
        if (
          !person ||
          person.family_id !== actor.familyId ||
          person.role !== actor.role ||
          person.token_version !== actor.generation
        )
          return { response: reply(401, { error: "Unauthorized" }) };
        if (!["parent", "teen", "child"].includes(person.role))
          return { response: reply(403, { error: "Forbidden" }) };
        const family = await db.family.findUnique({
          where: { id: actor.familyId },
          select: { features: true },
        });
        if (
          !family ||
          !isFeatureEnabled(normalizeFeatures(family.features), "chores")
        )
          return {
            response: reply(403, {
              error: "This feature is turned off for your family",
            }),
          };
        const chore = await db.chore.findUnique({
          where: { id: command.choreId },
        });
        if (!chore)
          return { response: reply(404, { error: "Chore not found" }) };
        if (chore.family_id !== actor.familyId)
          return { response: reply(403, { error: "Forbidden" }) };
        if (chore.assigned_to === null)
          return { response: reply(409, profileChoreLegacyWriteRefusal()) };
        if (
          command.kind === "undo" &&
          person.role !== "parent" &&
          chore.assigned_to !== person.id
        )
          return {
            response: reply(403, {
              error: "Only parents or the assignee can undo this chore",
            }),
          };
        let photo: string | null | undefined;
        if (command.kind === "complete") {
          const resolution = await resolveChorePhotoForWrite(
            actor.familyId,
            command.photoUrl,
            chore.photo_url,
            db as unknown as ChorePhotoReadDb,
          );
          if (!resolution.ok)
            return { response: reply(400, { error: resolution.error }) };
          photo = resolution.value;
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
          const snapshot: RoutineOccurrenceSnapshot = {
            ...chore,
            own_config: chore.routine_series_config,
            series_config: root?.routine_series_config ?? null,
            root_id: root?.id ?? null,
            root_recurrence_id: root?.recurrence_id ?? null,
          };
          if (
            ["inactive", "unsupported"].includes(
              routineOccurrencePolicy(snapshot),
            )
          )
            throw new RoutineOccurrenceUnavailableError();
          if (!["pending", "in_progress", "overdue"].includes(chore.status))
            return {
              response: reply(200, { success: true, alreadyCompleted: true }),
            };
        } else {
          if (chore.status === "verified")
            return {
              response: reply(409, {
                error:
                  "A parent has already checked this chore, so it stays done.",
                code: "CHORE_ALREADY_VERIFIED",
              }),
            };
          if (chore.status !== "completed")
            return {
              response: reply(200, { success: true, alreadyOpen: true }),
            };
        }
        const reads = db as unknown as ChoreAssigneeReadDb;
        let assignee: {
          assigned_to: string;
          assigned_member_id?: string;
        } | null = null;
        // Legacy successor creation and mapped-account Undo use the canonical
        // eligibility projector. Contradictions refuse; no identities are made.
        if (command.kind === "undo" && chore.assigned_member_id) {
          assignee = await eligibleChoreAssigneeFromReads(
            reads,
            actor.familyId,
            chore.assigned_to,
            { requireCanonical: true },
          );
          if (!assignee?.assigned_member_id)
            throw new HouseholdMemberIdentityConflict();
        } else if (
          command.kind === "complete" &&
          !chore.recurrence_id &&
          chore.frequency !== "once"
        ) {
          assignee = await eligibleChoreAssigneeFromReads(
            reads,
            actor.familyId,
            chore.assigned_to,
            { requireCanonical: !!chore.assigned_member_id },
          );
          if (!assignee) throw new HouseholdMemberIdentityConflict();
        }
        return { chore, person, photo, assignee };
      },
      store as unknown as NativeD1,
    );
    if ("response" in capture.value) {
      try {
        await session.batch(capture.checks(session));
        return capture.value.response!;
      } catch (cause) {
        if (isD1WriteConflict(cause)) continue;
        throw cause;
      }
    }
    const { chore, person, photo, assignee } = capture.value;
    const checks = capture.checks(session),
      effects: D1Statement[] = [];
    if (command.kind === "complete") {
      let successor: string | null = null;
      if (chore.recurrence_id) {
        const series = await prepareD1RecurringSeries(
          chore.recurrence_id,
          actor.familyId,
          now,
          store,
        );
        checks.push(...series.checks(session));
        effects.push(...series.writes(session).statements);
      } else if (chore.frequency !== "once") {
        if (
          !Array.isArray(chore.weekly_days) ||
          !chore.weekly_days.every((v) => typeof v === "number")
        )
          throw new Error("Invalid stored weekdays");
        const due = nextDueDate(
          chore.due_date,
          chore.frequency,
          chore.weekly_days as number[],
        );
        if (due) {
          successor = randomUUID();
          effects.push(
            session
              .prepare(
                `INSERT INTO "Chore"(id,family_id,title,description,points,assigned_to,assigned_member_id,due_date,status,frequency,difficulty,created_by,icon,routine,routine_order)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending','once',?9,?10,?11,?12,?13)`,
              )
              .bind(
                successor,
                actor.familyId,
                chore.title,
                chore.description,
                chore.points,
                assignee!.assigned_to,
                assignee!.assigned_member_id ?? null,
                due.getTime(),
                chore.difficulty,
                chore.created_by,
                chore.icon,
                chore.routine,
                chore.routine_order,
              ),
          );
        }
      }
      const update = session
        .prepare(
          `UPDATE "Chore" SET status='completed',completed_at=?1,photo_url=CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE photo_url END,
        photo_verified=CASE WHEN ?2 IS NOT NULL THEN 0 ELSE photo_verified END,successor_id=CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE successor_id END
        WHERE id=?4 AND family_id=?5 AND status IN ('pending','in_progress','overdue')`,
        )
        .bind(
          now.getTime(),
          photo || null,
          successor,
          chore.id,
          actor.familyId,
        );
      // All assertions precede all writes; the recurrence planner captured the
      // pre-completion state, which the status update is about to change.
      effects.unshift(update, d1WriteCheck(session, "changes()=1"));
      effects.push(
        session
          .prepare(
            `INSERT INTO "Activity"(id,family_id,user_id,type,title,subject_member_id,metadata,created_at) VALUES (?1,?2,?3,'chore_completed',?4,?5,?6,?7)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            person.id,
            `${person.name} completed "${chore.title}"`,
            chore.assigned_member_id,
            JSON.stringify({
              timeline: 1,
              actorKind: "person",
              target: { kind: "chore", id: chore.id },
            }),
            now.getTime(),
          ),
      );
    } else {
      effects.push(
        session
          .prepare(
            `UPDATE "Chore" SET status='pending',completed_at=NULL,successor_id=NULL,assigned_member_id=?1 WHERE id=?2 AND family_id=?3 AND status='completed'`,
          )
          .bind(
            assignee?.assigned_member_id ?? chore.assigned_member_id,
            chore.id,
            actor.familyId,
          ),
        d1WriteCheck(session, "changes()=1"),
      );
      if (chore.successor_id)
        effects.push(
          session
            .prepare(
              `DELETE FROM "Chore" WHERE id=?1 AND family_id=?2 AND status='pending' AND recurrence_id IS NULL`,
            )
            .bind(chore.successor_id, actor.familyId),
        );
    }
    try {
      await session.batch([...checks, ...effects]);
      return {
        status: 200,
        body:
          command.kind === "complete"
            ? { success: true, choreId: chore.id }
            : { success: true, choreId: chore.id, status: "pending" },
        completed: command.kind === "complete",
        ...(command.kind === "complete" ? { completedAt: now } : {}),
      };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return reply(409, {
    error: "The chore changed. Refresh and retry.",
    code: "CHORE_CHANGED",
  });
}
