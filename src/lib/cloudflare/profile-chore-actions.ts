/** Native protocol-2 device completion/Undo for email-free profile chores.
 *
 * This module deliberately does not call the account chore state adapter. A
 * profile has no User row, no XP/activity identity and no account authority;
 * the selected member is only a witnessed subject. Every state change and its
 * content-minimal device audit share one D1 batch with the retry receipt.
 */
import { randomUUID } from "node:crypto";
import type { DeviceActor } from "@/lib/device-session";
import { isDueTodaySomewhere } from "@/lib/chore-complete";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import { normalizeFeatures } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import {
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_TTL_MS,
} from "@/lib/idempotency-key";
import type { D1Statement, D1Store } from "./database";
import { getD1Database } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { readD1DeviceActor } from "./device-sessions";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { prepareD1RecurringSeries } from "./recurring-chores";
import { deviceErrorBody } from "@/lib/device-error";

type Input = {
  kind: "complete" | "undo";
  choreId: string;
  memberId: string;
  profile?: boolean;
};
type Result = { status: number; body: unknown; replayed?: boolean };
type Receipt = {
  id: string;
  family_id: string;
  user_id: string | null;
  action: string;
  request_hash: string;
  created_at: Date;
  expires_at: Date;
  response_status: number | null;
  response_body: unknown;
};
const failure = (status: number, code: string): Result => ({
  status,
  body: deviceErrorBody(code as any),
});

function profileActive(member: any, familyId: string, memberId: string) {
  const role = member ? profileRoleSchema.safeParse(member.role) : null;
  return Boolean(
    member &&
    member.id === memberId &&
    member.family_id === familyId &&
    member.archived_at === null &&
    member.erasure_user_id === null &&
    member.legacy_mapping === null &&
    member.account_link === null &&
    role?.success &&
    isProfileAgeAllowed(role.data, member.age),
  );
}

function profileRecurring(chore: any, policy: string) {
  const repeating =
    chore.recurrence_id !== null ||
    (chore.frequency !== null && chore.frequency !== "once");
  if (!repeating) return true;
  // Repeating profile chores must be represented by the native series
  // protocol. A legacy frequency-only row has no witnessed template to top
  // up, so completing it would silently drop the next occurrence.
  if (chore.recurrence_id === null) return false;
  return policy === "scheduled-once" || isProfileChoreRecurrenceSupported();
}

function receiptChecks(
  db: Pick<D1Store, "prepare">,
  prior: Receipt | null,
  scope: string,
  key: string,
  action: string,
  hash: string,
  familyId: string,
  now: number,
) {
  if (!prior)
    return [
      d1WriteCheck(
        db,
        'NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)',
        [scope, key],
      ),
    ];
  return [
    d1WriteCheck(
      db,
      `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND key=?3 AND (expires_at<=?4 OR (family_id=?5 AND user_id IS NULL AND action=?6 AND request_hash=?7 AND response_status IS NULL AND created_at=?8 AND created_at<=?9)))`,
      [
        prior.id,
        scope,
        key,
        now,
        familyId,
        action,
        hash,
        prior.created_at.getTime(),
        now - IDEMPOTENCY_LOCK_TIMEOUT_MS,
      ],
    ),
    db.prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1').bind(prior.id),
  ];
}

function insertReceipt(
  db: Pick<D1Store, "prepare">,
  id: string,
  scope: string,
  key: string,
  familyId: string,
  action: string,
  hash: string,
  result: Result,
  now: number,
  expires: number,
) {
  return db
    .prepare(
      `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10)`,
    )
    .bind(
      id,
      scope,
      key,
      familyId,
      action,
      hash,
      result.status,
      JSON.stringify(result.body),
      now,
      expires,
    );
}

function routinePolicy(chore: any, root: any | null) {
  // This is the same bounded policy projection used by the PostgreSQL helper.
  // Native profile commands refuse inactive/unsupported definitions; they do
  // not infer a new routine from a legacy recurrence id.
  const own = chore.routine_series_config as any;
  if (own && typeof own === "object" && own.state === "paused")
    return "inactive";
  if (
    root?.routine_series_config &&
    typeof root.routine_series_config === "object" &&
    root.routine_series_config.state === "paused"
  )
    return "inactive";
  if (
    own &&
    typeof own === "object" &&
    own.protocol &&
    own.protocol !== "herewoven.routine-step-series.v1"
  )
    return "unsupported";
  return "legacy";
}

export async function runD1ProfileChore(
  actor: DeviceActor,
  input: Input,
  key: string,
  options: { database?: D1Store; now?: Date } = {},
): Promise<Result> {
  const store = options.database ?? (await getD1Database());
  const session = store.withSession("first-primary");
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid profile chore clock");
  if (!isProfileChoreEnabled())
    return failure(409, "MEMBER_PROTOCOL_UNAVAILABLE");
  const action = `device.chore.${input.kind}`;
  const scope = `device:${actor.deviceId}`;
  const hash = hashIdempotentRequest(action, {
    choreId: input.choreId,
    protocol: 2,
    memberId: input.memberId,
  });
  for (let attempt = 0; attempt < 16; attempt++) {
    const capture = await captureD1Reads(
      async (db) => {
        const access = await readD1DeviceActor(db, actor, now);
        const family = await db.family.findUnique({
          where: { id: actor.familyId },
          select: { features: true, device_writes_enabled: true },
        });
        const member = await db.householdMember.findFirst({
          where: { id: input.memberId, family_id: actor.familyId },
          select: {
            id: true,
            family_id: true,
            name: true,
            role: true,
            age: true,
            archived_at: true,
            erasure_user_id: true,
            legacy_mapping: { select: { user_id: true } },
            account_link: { select: { user_id: true } },
          },
        });
        const chore = await db.chore.findFirst({
          where: { id: input.choreId, family_id: actor.familyId },
          select: {
            id: true,
            family_id: true,
            title: true,
            assigned_to: true,
            assigned_member_id: true,
            member_subject_erased: true,
            due_date: true,
            status: true,
            frequency: true,
            recurrence_id: true,
            is_template: true,
            rotation_member_ids: true,
            completed_at: true,
            successor_id: true,
            routine_series_config: true,
          },
        });
        const root = chore?.recurrence_id
          ? await db.chore.findFirst({
              where: { id: chore.recurrence_id, family_id: actor.familyId },
              select: {
                id: true,
                recurrence_id: true,
                routine_series_config: true,
              },
            })
          : null;
        const audits =
          input.kind === "undo"
            ? await db.deviceAuditEvent.findMany({
                where: {
                  family_id: actor.familyId,
                  device_id: actor.deviceId,
                  subject_member_id: input.memberId,
                  type: "device.member_action",
                  created_at: { gte: new Date(now.getTime() - 120000) },
                },
                select: { metadata: true, created_at: true },
                orderBy: { created_at: "desc" },
                take: 100,
              })
            : [];
        const prior = await db.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key } },
        });
        return { access, family, member, chore, root, audits, prior };
      },
      store as unknown as NativeD1,
    );
    const { access, family, member, chore, root, audits, prior } =
      capture.value;
    if (!access.ok) return failure(access.status, access.code);
    if (!family || !family.device_writes_enabled)
      return failure(403, "DEVICE_WRITES_OFF");
    const features = normalizeProfileFeatures(family.features);
    if (!features.chores) return failure(403, "FEATURE_DISABLED");
    if (!profileActive(member, actor.familyId, input.memberId))
      return failure(409, "MEMBER_PROTOCOL_UNAVAILABLE");
    if (
      prior &&
      (prior.family_id !== actor.familyId ||
        prior.user_id !== null ||
        prior.action !== action ||
        prior.request_hash !== hash)
    )
      return failure(422, "IDEMPOTENCY_KEY_REUSED");
    if (
      prior &&
      prior.expires_at.getTime() > now.getTime() &&
      prior.response_status !== null &&
      prior.response_body !== null
    ) {
      try {
        await session.batch(capture.checks(session));
        return {
          status: prior.response_status!,
          body: prior.response_body,
          replayed: true,
        };
      } catch (cause) {
        if (isD1WriteConflict(cause)) continue;
        throw cause;
      }
    }
    if (
      prior &&
      prior.created_at.getTime() > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS
    )
      return failure(409, "IDEMPOTENCY_IN_PROGRESS");
    if (
      !chore ||
      chore.assigned_to !== null ||
      chore.assigned_member_id !== input.memberId ||
      chore.member_subject_erased
    )
      return failure(404, "NOT_FOUND");
    const policy = routinePolicy(chore, root);
    if (
      policy === "inactive" ||
      policy === "unsupported" ||
      !profileRecurring(chore, policy)
    )
      return failure(409, "MEMBER_PROTOCOL_UNAVAILABLE");
    if (input.kind === "complete" && !isDueTodaySomewhere(chore.due_date, now))
      return failure(409, "CHORE_NOT_DUE_TODAY");
    const persistNoop = async (result: Result) => {
      const receiptId = prior?.id ?? randomUUID();
      try {
        await session.batch([
          ...capture.checks(session),
          ...receiptChecks(
            session,
            prior,
            scope,
            key,
            action,
            hash,
            actor.familyId,
            now.getTime(),
          ),
          insertReceipt(
            session,
            receiptId,
            scope,
            key,
            actor.familyId,
            action,
            hash,
            result,
            now.getTime(),
            prior?.expires_at.getTime() ?? now.getTime() + IDEMPOTENCY_TTL_MS,
          ),
        ]);
        return result;
      } catch (cause) {
        if (isD1WriteConflict(cause)) return null;
        throw cause;
      }
    };
    if (
      input.kind === "complete" &&
      !["pending", "in_progress", "overdue"].includes(chore.status)
    ) {
      const result = await persistNoop({
        status: 200,
        body: {
          chore: { id: chore.id, status: "completed" },
          alreadyCompleted: true,
        },
      });
      if (!result) continue;
      return result;
    }
    if (input.kind === "undo") {
      if (chore.status === "verified")
        return failure(409, "CHORE_ALREADY_VERIFIED");
      if (chore.status !== "completed") {
        const result = await persistNoop({
          status: 200,
          body: {
            chore: { id: chore.id, status: "pending" },
            alreadyOpen: true,
          },
        });
        if (!result) continue;
        return result;
      }
      const own = audits.find((row: any) => {
        const metadata = row.metadata as any;
        return (
          metadata?.action === "chore_complete" &&
          metadata?.targetId === chore.id
        );
      });
      if (
        !own ||
        (chore.completed_at &&
          chore.completed_at.getTime() > own.created_at.getTime())
      )
        return failure(403, "UNDO_NOT_ALLOWED");
    }
    const receiptId = prior?.id ?? randomUUID();
    const checks: D1Statement[] = [...capture.checks(session)];
    const effects: D1Statement[] = [];
    if (input.kind === "complete") {
      effects.push(
        session
          .prepare(
            `UPDATE "Chore" SET status='completed',completed_at=?1 WHERE id=?2 AND family_id=?3 AND assigned_to IS NULL AND assigned_member_id=?4 AND status IN ('pending','in_progress','overdue')`,
          )
          .bind(now.getTime(), chore.id, actor.familyId, input.memberId),
        d1WriteCheck(session, "changes()=1"),
      );
      effects.push(
        session
          .prepare(
            `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at) VALUES (?1,?2,?3,NULL,?4,0,'device.member_action',?5,?6)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            actor.deviceId,
            input.memberId,
            JSON.stringify({
              action: "chore_complete",
              targetType: "chore",
              targetId: chore.id,
            }),
            now.getTime(),
          ),
      );
      if (chore.recurrence_id) {
        const series = await prepareD1RecurringSeries(
          chore.recurrence_id,
          actor.familyId,
          now,
          store,
        );
        checks.push(...series.checks(session));
        effects.push(...series.writes(session).statements);
      }
    } else {
      effects.push(
        session
          .prepare(
            `UPDATE "Chore" SET status='pending',completed_at=NULL,successor_id=NULL WHERE id=?1 AND family_id=?2 AND assigned_to IS NULL AND assigned_member_id=?3 AND status='completed'`,
          )
          .bind(chore.id, actor.familyId, input.memberId),
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
      effects.push(
        session
          .prepare(
            `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at) VALUES (?1,?2,?3,NULL,?4,0,'device.member_action',?5,?6)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            actor.deviceId,
            input.memberId,
            JSON.stringify({
              action: "chore_undo",
              targetType: "chore",
              targetId: chore.id,
            }),
            now.getTime(),
          ),
      );
    }
    const result: Result =
      input.kind === "complete"
        ? {
            status: 200,
            body: {
              chore: { id: chore.id, status: "completed" },
              alreadyCompleted: false,
            },
          }
        : {
            status: 200,
            body: {
              chore: { id: chore.id, status: "pending" },
              alreadyOpen: false,
            },
          };
    checks.push(
      ...receiptChecks(
        session,
        prior,
        scope,
        key,
        action,
        hash,
        actor.familyId,
        now.getTime(),
      ),
    );
    effects.push(
      insertReceipt(
        session,
        receiptId,
        scope,
        key,
        actor.familyId,
        action,
        hash,
        result,
        now.getTime(),
        prior?.expires_at.getTime() ?? now.getTime() + IDEMPOTENCY_TTL_MS,
      ),
    );
    try {
      await session.batch([...checks, ...effects]);
      return result;
    } catch (cause) {
      if (isD1WriteConflict(cause)) continue;
      throw cause;
    }
  }
  return failure(409, "IDEMPOTENCY_IN_PROGRESS");
}

function normalizeProfileFeatures(raw: unknown) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  return normalizeFeatures(value);
}
