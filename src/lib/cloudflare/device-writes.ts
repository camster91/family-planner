import { randomUUID } from "node:crypto";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { isGroceryListType } from "@/lib/grocery-display";
import { isDueTodaySomewhere } from "@/lib/chore-complete";
import { nextDueDate } from "@/lib/chore-recurrence-dates";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import {
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_TTL_MS,
} from "@/lib/idempotency-key";
import { isProfileChoreEnabled } from "@/lib/chore-profile";
import type { DeviceActor } from "@/lib/device-session";
import { getD1Database, type D1Statement, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { isD1WriteConflict, d1WriteCheck } from "./write-check";
import { readD1DeviceActor } from "./device-sessions";
import { prepareD1RecurringSeries } from "./recurring-chores";
import { runD1ProfileChore } from "./profile-chore-actions";
import { deviceErrorBody } from "@/lib/device-error";
import { prepareD1SectionTick } from "./list-section-tick";

export type D1DeviceWriteFeature = "lists" | "chores";
export type D1DeviceWriteGate =
  | { ok: true; member: { id: string; name: string } }
  | { ok: false; status: 400 | 403 | 409; code: string };

export type D1DeviceWriteResult = {
  status: number;
  body: unknown;
  replayed?: boolean;
};

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

const failure = (status: number, code: string): D1DeviceWriteResult => ({
  status,
  body: deviceErrorBody(code as any),
});

function validClock(now: Date) {
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid device write clock");
}

/** Gate reads used by the HTTP parser. The command repeats these reads in its
 * witness so an authority/feature/member change cannot slip into the effect. */
export async function readD1DeviceWriteGate(
  actor: DeviceActor,
  feature: D1DeviceWriteFeature,
  memberId: string,
  database?: D1Store,
): Promise<D1DeviceWriteGate> {
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const family = await db
    .prepare('SELECT features,device_writes_enabled FROM "Family" WHERE id=?1')
    .bind(actor.familyId)
    .first<{ features: string | null; device_writes_enabled: number | null }>();
  if (!family || family.device_writes_enabled !== 1)
    return { ok: false, status: 403, code: "DEVICE_WRITES_OFF" };
  const raw = family.features === null ? null : JSON.parse(family.features);
  if (!isFeatureEnabled(normalizeFeatures(raw), feature))
    return { ok: false, status: 403, code: "FEATURE_DISABLED" };
  const member = await db
    .prepare(
      "SELECT id,name FROM \"User\" WHERE id=?1 AND family_id=?2 AND role IN ('parent','teen','child')",
    )
    .bind(memberId, actor.familyId)
    .first<{ id: string; name: string }>();
  return member
    ? { ok: true, member }
    : { ok: false, status: 400, code: "ACTING_MEMBER_INVALID" };
}

async function receipt(
  db: any,
  scope: string,
  key: string,
): Promise<Receipt | null> {
  return db.idempotencyRecord.findUnique({
    where: { scope_key: { scope, key } },
  });
}

function receiptResponse(prior: Receipt): D1DeviceWriteResult | null {
  if (prior.response_status === null || prior.response_body === null)
    return null;
  return {
    status: prior.response_status,
    body: prior.response_body,
    replayed: true,
  };
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
  const checks: D1Statement[] = [];
  if (prior) {
    checks.push(
      d1WriteCheck(
        db,
        `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND key=?3 AND
          (expires_at<=?4 OR (family_id=?5 AND user_id IS NULL AND action=?6 AND request_hash=?7
            AND response_status IS NULL AND created_at=?8 AND created_at<=?9)))`,
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
    );
    checks.push(
      db.prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1').bind(prior.id),
    );
  } else {
    checks.push(
      d1WriteCheck(
        db,
        'NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)',
        [scope, key],
      ),
    );
  }
  return checks;
}

function receiptInsert(
  db: Pick<D1Store, "prepare">,
  id: string,
  scope: string,
  key: string,
  familyId: string,
  action: string,
  hash: string,
  body: unknown,
  status: number,
  now: number,
  expiry: number,
) {
  return db
    .prepare(
      `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at)
       VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10)`,
    )
    .bind(
      id,
      scope,
      key,
      familyId,
      action,
      hash,
      status,
      JSON.stringify(body),
      now,
      expiry,
    );
}

type SharedRead = {
  access: Awaited<ReturnType<typeof readD1DeviceActor>>;
  family: { features: unknown; device_writes_enabled: boolean } | null;
  member: { id: string; name: string } | null;
  prior: Receipt | null;
  receiptId?: string;
};

async function readShared(
  db: any,
  actor: DeviceActor,
  feature: D1DeviceWriteFeature,
  memberId: string,
  action: string,
  key: string,
  now: Date,
): Promise<SharedRead> {
  const access = await readD1DeviceActor(db, actor, now);
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true, device_writes_enabled: true },
  });
  const member = await db.user.findFirst({
    where: {
      id: memberId,
      family_id: actor.familyId,
      role: { in: ["parent", "teen", "child"] },
    },
    select: { id: true, name: true },
  });
  const enabled = Boolean(
    family &&
    family.device_writes_enabled &&
    isFeatureEnabled(normalizeFeatures(family.features), feature),
  );
  const prior =
    enabled && member
      ? await db.idempotencyRecord.findUnique({
          where: { scope_key: { scope: `device:${actor.deviceId}`, key } },
        })
      : null;
  return {
    access,
    family: family
      ? {
          ...family,
          device_writes_enabled: Boolean(family.device_writes_enabled),
        }
      : null,
    member,
    prior,
  };
}

async function runShared(
  actor: DeviceActor,
  feature: D1DeviceWriteFeature,
  memberId: string,
  key: string,
  action: string,
  hashed: unknown,
  target: (
    db: any,
    shared: SharedRead,
    now: Date,
    sql: Pick<D1Store, "prepare">,
  ) => Promise<{
    result: D1DeviceWriteResult;
    checks: D1Statement[];
    effects: D1Statement[];
  }>,
  options: { database?: D1Store; now?: Date } = {},
): Promise<D1DeviceWriteResult> {
  const store = options.database ?? (await getD1Database());
  const session = store.withSession("first-primary");
  const now = options.now ?? new Date();
  validClock(now);
  const scope = `device:${actor.deviceId}`;
  const hash = hashIdempotentRequest(action, hashed);
  for (let attempt = 0; attempt < 16; attempt++) {
    const capture = await captureD1Reads(
      async (db) => {
        const shared = await readShared(
          db,
          actor,
          feature,
          memberId,
          action,
          key,
          now,
        );
        // Planning must use the same read-only facade as the authority read so
        // every target/list/chore lookup is witnessed at the commit boundary.
        // The only extra capability is the explicit statement builder used to
        // construct effects; it never exposes a mutable ORM or transaction.
        if (
          !shared.access.ok ||
          !shared.family ||
          !shared.family.device_writes_enabled ||
          !isFeatureEnabled(
            normalizeFeatures(shared.family.features),
            feature,
          ) ||
          !shared.member
        )
          return { shared, planned: null };
        // Allocate the receipt identity before planning the target. List-item
        // effects use this same id as `source_request_id`, which lets a retry
        // recover an item committed before the response receipt was stored.
        // The id is retained on the captured shared value for the effect plan
        // and the receipt insert below.
        shared.receiptId = shared.prior?.id ?? randomUUID();
        const planned = await target(db, shared, now, session);
        return { shared, planned };
      },
      store as unknown as NativeD1,
    );
    const { shared, planned } = capture.value;
    if (!shared.access.ok) {
      const auth = shared.access;
      return failure(auth.status, auth.code);
    }
    if (!shared.family || !shared.family.device_writes_enabled)
      return failure(403, "DEVICE_WRITES_OFF");
    if (!isFeatureEnabled(normalizeFeatures(shared.family.features), feature))
      return failure(403, "FEATURE_DISABLED");
    if (!shared.member) return failure(400, "ACTING_MEMBER_INVALID");
    const prior = shared.prior;
    if (prior) {
      if (
        prior.family_id !== actor.familyId ||
        prior.user_id !== null ||
        prior.action !== action ||
        prior.request_hash !== hash
      )
        return failure(422, "IDEMPOTENCY_KEY_REUSED");
      // A completed receipt is replayable only while its bounded retention
      // window is live. Once expired, the same key may be safely reclaimed
      // through the stale-receipt check below; returning the old response here
      // would bypass current target/member authority and retain unbounded
      // device state.
      const replay =
        prior.expires_at.getTime() > now.getTime()
          ? receiptResponse(prior)
          : null;
      if (replay) {
        try {
          await session.batch(capture.checks(session));
          return replay;
        } catch (cause) {
          if (isD1WriteConflict(cause)) continue;
          throw cause;
        }
      }
      if (
        prior.created_at.getTime() >
        now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS
      )
        return failure(409, "IDEMPOTENCY_IN_PROGRESS");
    }
    if (!planned) return failure(500, "INTERNAL_ERROR");
    if (planned.result.status < 200 || planned.result.status >= 300) {
      // A stale abandoned receipt must not block a failed target forever.
      if (!prior) return planned.result;
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
        ]);
        return planned.result;
      } catch (cause) {
        if (isD1WriteConflict(cause)) continue;
        throw cause;
      }
    }
    const body = planned.result.body;
    const id = shared.receiptId ?? prior?.id ?? randomUUID();
    const checks = [
      ...capture.checks(session),
      ...planned.checks,
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
    ];
    const effects = [
      ...planned.effects,
      receiptInsert(
        session,
        id,
        scope,
        key,
        actor.familyId,
        action,
        hash,
        body,
        planned.result.status,
        now.getTime(),
        prior?.expires_at.getTime() ?? now.getTime() + IDEMPOTENCY_TTL_MS,
      ),
    ];
    try {
      await session.batch([...checks, ...effects]);
      return { ...planned.result, replayed: false };
    } catch (cause) {
      if (isD1WriteConflict(cause)) continue;
      throw cause;
    }
  }
  return failure(409, "IDEMPOTENCY_IN_PROGRESS");
}

export async function runD1DeviceListCheck(
  actor: DeviceActor,
  input: { itemId: string; checked: boolean; memberId: string },
  key: string,
  options: { database?: D1Store; now?: Date } = {},
) {
  return runShared(
    actor,
    "lists",
    input.memberId,
    key,
    "device.list-item.set-checked",
    input,
    async (db, shared, now, sql) => {
      const item = await db.listItem.findFirst({
        where: { id: input.itemId, list: { family_id: actor.familyId } },
        select: {
          id: true,
          content: true,
          ingredient_id: true,
          checked: true,
          list: { select: { id: true, type: true } },
        },
      });
      if (!item || !isGroceryListType(item.list.type))
        return { result: failure(404, "NOT_FOUND"), checks: [], effects: [] };
      if (item.checked === input.checked)
        return {
          result: {
            status: 200,
            body: { item: { id: item.id, checked: item.checked } },
          },
          checks: [],
          effects: [],
        };
      const at = now.getTime();
      const update = sql
        .prepare(
          `UPDATE "ListItem" SET checked=?1,checked_by=?2,checked_at=?3,updated_at=?4 WHERE id=?5 AND list_id=?6 AND checked=?7`,
        )
        .bind(
          input.checked ? 1 : 0,
          input.checked ? shared.member!.id : null,
          input.checked ? at : null,
          at,
          item.id,
          item.list.id,
          item.checked ? 1 : 0,
        );
      const audit = sql
        .prepare(
          `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at)
       VALUES (?1,?2,?3,?4,NULL,0,'device.member_action',?5,?6)`,
        )
        .bind(
          randomUUID(),
          actor.familyId,
          actor.deviceId,
          shared.member!.id,
          JSON.stringify({
            action: input.checked ? "list_item_check" : "list_item_uncheck",
            targetType: "list_item",
            targetId: item.id,
          }),
          at,
        );
      const tick = input.checked
        ? await prepareD1SectionTick(
            db,
            actor.familyId,
            item.list.id,
            item.content,
            item.ingredient_id,
            now,
          )
        : null;
      return {
        result: {
          status: 200,
          body: { item: { id: item.id, checked: input.checked } },
        },
        checks: [
          d1WriteCheck(
            sql,
            "EXISTS(SELECT 1 FROM \"ListItem\" i JOIN \"List\" l ON l.id=i.list_id WHERE i.id=?1 AND l.family_id=?2 AND l.type IN ('grocery','shopping'))",
            [item.id, actor.familyId],
          ),
        ],
        effects: [
          update,
          d1WriteCheck(sql, "changes()=1"),
          audit,
          ...(tick ? tick(sql) : []),
        ],
      };
    },
    options,
  );
}

export async function runD1DeviceListAdd(
  actor: DeviceActor,
  input: { listId: string; content: string; memberId: string },
  key: string,
  options: { database?: D1Store; now?: Date } = {},
) {
  return runShared(
    actor,
    "lists",
    input.memberId,
    key,
    "device.list-item.add",
    input,
    async (db, shared, now, sql) => {
      const list = await db.list.findFirst({
        where: { id: input.listId, family_id: actor.familyId },
        select: { id: true, type: true },
      });
      if (!list || !isGroceryListType(list.type))
        return { result: failure(404, "NOT_FOUND"), checks: [], effects: [] };
      const existing = await db.listItem.findFirst({
        where: {
          source_request_id:
            (shared as SharedRead & { receiptId?: string }).receiptId ??
            shared.prior?.id ??
            "__none__",
          list_id: input.listId,
        },
        select: { id: true, content: true, quantity: true },
      });
      if (existing) {
        return {
          result: {
            status: 201,
            body: {
              item: {
                id: existing.id,
                content: existing.content,
                quantity: existing.quantity,
                listId: input.listId,
              },
            },
          },
          checks: [],
          effects: [],
        };
      }
      const last = await db.listItem.findFirst({
        where: { list_id: input.listId },
        orderBy: [{ position: "desc" }, { id: "desc" }],
        select: { position: true },
      });
      const id = randomUUID(),
        position = (last?.position ?? 0) + 1,
        at = now.getTime();
      const body = {
        item: { id, content: input.content, quantity: 1, listId: input.listId },
      };
      const insert = sql
        .prepare(
          `INSERT INTO "ListItem"(id,list_id,content,checked,quantity,added_by,position,source_request_id,created_at,updated_at) VALUES (?1,?2,?3,0,1,?4,?5,?6,?7,?7)`,
        )
        .bind(
          id,
          input.listId,
          input.content,
          shared.member!.id,
          position,
          (shared as SharedRead & { receiptId?: string }).receiptId ??
            shared.prior?.id ??
            null,
          at,
        );
      const audit = sql
        .prepare(
          `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at)
       VALUES (?1,?2,?3,?4,NULL,0,'device.member_action',?5,?6)`,
        )
        .bind(
          randomUUID(),
          actor.familyId,
          actor.deviceId,
          shared.member!.id,
          JSON.stringify({
            action: "list_item_add",
            targetType: "list_item",
            targetId: id,
          }),
          at,
        );
      return {
        result: { status: 201, body },
        checks: [
          d1WriteCheck(
            sql,
            "EXISTS(SELECT 1 FROM \"List\" WHERE id=?1 AND family_id=?2 AND type IN ('grocery','shopping'))",
            [input.listId, actor.familyId],
          ),
        ],
        effects: [insert, audit],
      };
    },
    options,
  );
}

export async function runD1DeviceChore(
  actor: DeviceActor,
  input: {
    kind: "complete" | "undo";
    choreId: string;
    memberId: string;
    profile?: boolean;
  },
  key: string,
  options: { database?: D1Store; now?: Date } = {},
): Promise<D1DeviceWriteResult> {
  if (input.profile) return runD1ProfileChore(actor, input, key, options);
  const now = options.now ?? new Date();
  const result = await runShared(
    actor,
    "chores",
    input.memberId,
    key,
    `device.chore.${input.kind}`,
    input,
    async (db, shared, clock, sql) => {
      const chore = await db.chore.findFirst({
        where: { id: input.choreId, family_id: actor.familyId },
        select: {
          id: true,
          family_id: true,
          title: true,
          description: true,
          points: true,
          assigned_to: true,
          assigned_member_id: true,
          member_subject_erased: true,
          due_date: true,
          status: true,
          frequency: true,
          weekly_days: true,
          difficulty: true,
          created_by: true,
          icon: true,
          routine: true,
          routine_order: true,
          recurrence_id: true,
          routine_series_config: true,
          rotation_member_ids: true,
          successor_id: true,
          completed_at: true,
        },
      });
      if (!chore)
        return { result: failure(404, "NOT_FOUND"), checks: [], effects: [] };
      if (chore.assigned_to === null)
        return {
          result: failure(409, "MEMBER_PROTOCOL_UNAVAILABLE"),
          checks: [],
          effects: [],
        };
      if (
        input.kind === "complete" &&
        !isDueTodaySomewhere(chore.due_date, clock)
      )
        return {
          result: failure(409, "CHORE_NOT_DUE_TODAY"),
          checks: [],
          effects: [],
        };
      if (
        input.kind === "complete" &&
        !["pending", "in_progress", "overdue"].includes(chore.status)
      )
        return {
          result: {
            status: 200,
            body: {
              chore: { id: chore.id, status: chore.status },
              alreadyCompleted: true,
            },
          },
          checks: [],
          effects: [],
        };
      if (input.kind === "undo") {
        if (chore.status === "verified")
          return {
            result: failure(409, "CHORE_ALREADY_VERIFIED"),
            checks: [],
            effects: [],
          };
        if (chore.status !== "completed")
          return {
            result: {
              status: 200,
              body: {
                chore: { id: chore.id, status: "pending" },
                alreadyOpen: true,
              },
            },
            checks: [],
            effects: [],
          };
        const audits = await db.deviceAuditEvent.findMany({
          where: {
            family_id: actor.familyId,
            device_id: actor.deviceId,
            type: "device.member_action",
            created_at: { gte: new Date(clock.getTime() - 120000) },
          },
          select: { metadata: true, created_at: true },
          orderBy: { created_at: "desc" },
          take: 100,
        });
        const own = audits.find((row: any) => {
          const m = row.metadata as {
            action?: unknown;
            targetId?: unknown;
          } | null;
          return m?.action === "chore_complete" && m.targetId === chore.id;
        });
        if (
          !own ||
          (chore.completed_at &&
            chore.completed_at.getTime() > own.created_at.getTime())
        )
          return {
            result: failure(403, "UNDO_NOT_ALLOWED"),
            checks: [],
            effects: [],
          };
        // A mapped account chore may only be reopened while its canonical
        // profile identity is still valid. This mirrors the person-session
        // state transition and prevents a device undo from reviving work for
        // an archived, erased, or contradictory subject.
        if (chore.assigned_member_id) {
          const assignee = await eligibleChoreAssigneeFromReads(
            db as unknown as ChoreAssigneeReadDb,
            actor.familyId,
            chore.assigned_to,
            { requireCanonical: true },
          );
          if (!assignee?.assigned_member_id)
            return {
              result: failure(409, "IDENTITY_CONFLICT"),
              checks: [],
              effects: [],
            };
        }
      }
      const at = clock.getTime();
      if (input.kind === "complete") {
        let successor: string | null = null;
        let assignee: {
          assigned_to: string;
          assigned_member_id?: string;
        } | null = null;
        if (!chore.recurrence_id && chore.frequency !== "once") {
          if (
            !Array.isArray(chore.weekly_days) ||
            !chore.weekly_days.every(
              (value: unknown) => typeof value === "number",
            )
          )
            throw new Error("Invalid stored weekdays");
          assignee = await eligibleChoreAssigneeFromReads(
            db as unknown as ChoreAssigneeReadDb,
            actor.familyId,
            chore.assigned_to,
            { requireCanonical: chore.assigned_member_id !== null },
          );
          if (!assignee)
            return {
              result: failure(409, "IDENTITY_CONFLICT"),
              checks: [],
              effects: [],
            };
          const due = nextDueDate(
            chore.due_date,
            chore.frequency,
            chore.weekly_days as number[],
          );
          if (due) successor = randomUUID();
        }
        const update = sql
          .prepare(
            `UPDATE "Chore" SET status='completed',completed_at=?1,successor_id=CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE successor_id END WHERE id=?3 AND family_id=?4 AND status IN ('pending','in_progress','overdue')`,
          )
          .bind(at, successor, chore.id, actor.familyId);
        const activity = sql
          .prepare(
            `INSERT INTO "Activity"(id,family_id,user_id,subject_member_id,subject_member_erased,type,title,metadata,created_at) VALUES (?1,?2,?3,?4,0,'chore_completed',?5,?6,?7)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            shared.member!.id,
            chore.assigned_member_id,
            `${shared.member!.name} completed "${chore.title}"`,
            JSON.stringify({
              timeline: 1,
              actorKind: "device",
              target: { kind: "chore", id: chore.id },
            }),
            at,
          );
        const effects: D1Statement[] = [];
        if (successor && assignee) {
          const due = nextDueDate(
            chore.due_date,
            chore.frequency,
            chore.weekly_days as number[],
          );
          if (due)
            effects.push(
              sql
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
                  assignee.assigned_to,
                  assignee.assigned_member_id ?? null,
                  due.getTime(),
                  chore.difficulty,
                  chore.created_by,
                  chore.icon,
                  chore.routine,
                  chore.routine_order,
                ),
            );
        }
        effects.push(update, d1WriteCheck(sql, "changes()=1"), activity);
        const checks: D1Statement[] = [];
        if (chore.recurrence_id) {
          const series = await prepareD1RecurringSeries(
            chore.recurrence_id,
            actor.familyId,
            clock,
            options.database ?? (await getD1Database()),
          );
          checks.push(...series.checks(sql));
          effects.push(...series.writes(sql).statements);
        }
        const audit = sql
          .prepare(
            `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at) VALUES (?1,?2,?3,?4,NULL,0,'device.member_action',?5,?6)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            actor.deviceId,
            shared.member!.id,
            JSON.stringify({
              action: "chore_complete",
              targetType: "chore",
              targetId: chore.id,
            }),
            at,
          );
        effects.push(audit);
        return {
          result: {
            status: 200,
            body: {
              chore: { id: chore.id, status: "completed" },
              alreadyCompleted: false,
            },
          },
          checks,
          effects,
        };
      }
      const update = sql
        .prepare(
          `UPDATE "Chore" SET status='pending',completed_at=NULL,successor_id=NULL WHERE id=?1 AND family_id=?2 AND status='completed'`,
        )
        .bind(chore.id, actor.familyId);
      const effects: D1Statement[] = [update, d1WriteCheck(sql, "changes()=1")];
      if (chore.successor_id)
        effects.push(
          sql
            .prepare(
              `DELETE FROM "Chore" WHERE id=?1 AND family_id=?2 AND status='pending' AND recurrence_id IS NULL`,
            )
            .bind(chore.successor_id, actor.familyId),
        );
      effects.push(
        sql
          .prepare(
            `INSERT INTO "DeviceAuditEvent"(id,family_id,device_id,actor_user_id,subject_member_id,subject_member_erased,type,metadata,created_at) VALUES (?1,?2,?3,?4,NULL,0,'device.member_action',?5,?6)`,
          )
          .bind(
            randomUUID(),
            actor.familyId,
            actor.deviceId,
            shared.member!.id,
            JSON.stringify({
              action: "chore_undo",
              targetType: "chore",
              targetId: chore.id,
            }),
            at,
          ),
      );
      return {
        result: {
          status: 200,
          body: {
            chore: { id: chore.id, status: "pending" },
            alreadyOpen: false,
          },
        },
        checks: [],
        effects,
      };
    },
    options,
  );
  return result;
}
