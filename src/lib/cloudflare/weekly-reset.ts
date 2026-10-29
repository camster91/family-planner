/** Native D1 weekly-review projection and progress effect.
 *
 * The review is deliberately a read projection: it never invents domain
 * rows when an optional source is unavailable.  Progress is the only write,
 * and is committed with the same D1 idempotency receipt used by the other
 * native person effects.
 */
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { addDaysToKey, dayKeyFor } from "@/lib/local-day-key";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  WEEKLY_RESET_PROTOCOL,
  WeeklyResetError,
  planWeeklyReset,
  weeklyResetMatches,
  weeklyResetRecord,
  weeklyResetReceipt,
  weeklyResetSections,
  type WeeklyResetCommand,
  type WeeklyResetRecord,
  type WeeklyResetScope,
  type WeeklyResetStep,
} from "@/lib/weekly-reset";
import {
  weeklyResetSummary,
  type WeeklyResetSummary,
} from "@/lib/weekly-reset-summary-contract";
import { weeklyResetWindow } from "@/lib/weekly-reset-summary";
import {
  WEEKLY_RESET_RECOVERY,
  weeklyResetRecoveryReview,
  type WeeklyResetRecoveryEntry,
} from "@/lib/weekly-reset-recovery";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";
import { d1WriteCheck } from "./write-check";

export type D1WeeklyResetActor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};

const LIMIT = 8;
const failure = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

function jsonObject(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function short(value: string | null | undefined) {
  return Array.from((value ?? "").normalize("NFC")).slice(0, 240).join("");
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value: unknown) {
  return asDate(value)?.toISOString() ?? null;
}

type Authority = {
  user: {
    id: string;
    family_id: string | null;
    role: string;
    token_version: number;
    email_verified: boolean;
    weekly_reset_progress: unknown;
    weekly_reset_revision: number;
  };
  features: ReturnType<typeof normalizeFeatures>;
};

async function authority(
  db: D1ReadClient,
  actor: D1WeeklyResetActor,
): Promise<Authority> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        family_id: true,
        role: true,
        token_version: true,
        email_verified: true,
        weekly_reset_progress: true,
        weekly_reset_revision: true,
      },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    }),
  ]);
  if (!user || user.token_version !== actor.tokenVersion)
    throw new WeeklyResetError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new WeeklyResetError("FORBIDDEN");
  if (!family) throw new WeeklyResetError("FORBIDDEN");
  return {
    user: user as Authority["user"],
    features: normalizeFeatures(jsonObject(family.features)),
  };
}

function storedRecord(user: Authority["user"]): WeeklyResetRecord | null {
  if (!Number.isSafeInteger(user.weekly_reset_revision) || user.weekly_reset_revision < 0)
    throw new WeeklyResetError("UNSUPPORTED");
  if (user.weekly_reset_progress == null) return null;
  const parsed = weeklyResetRecord.safeParse(jsonObject(user.weekly_reset_progress));
  if (!parsed.success) throw new WeeklyResetError("UNSUPPORTED");
  return parsed.data;
}

async function readWithAuthority<T>(
  actor: D1WeeklyResetActor,
  read: (db: D1ReadClient, auth: Authority) => Promise<T>,
  database?: D1Store,
) {
  const store = database ?? await getD1Database();
  return withD1ReadClient(async (db) => read(db, await authority(db, actor)), store as unknown as NativeD1);
}

export function authorizeD1WeeklyReset(actor: D1WeeklyResetActor, database?: D1Store) {
  return readWithAuthority(actor, async () => undefined, database);
}

export function readD1WeeklyReset(
  actor: D1WeeklyResetActor,
  scope: WeeklyResetScope,
  database?: D1Store,
) {
  return readWithAuthority(actor, async (_db, auth) => {
    const stored = storedRecord(auth.user);
    const record = weeklyResetMatches(stored, actor.familyId, scope) ? stored : null;
    const steps = weeklyResetSections(auth.user.role, auth.features).map((section) => ({
      ...section,
      state: record?.steps[section.id] ?? "pending",
    }));
    return {
      protocol: WEEKLY_RESET_PROTOCOL,
      owner: { userId: auth.user.id, familyId: actor.familyId },
      scope,
      revision: auth.user.weekly_reset_revision,
      started: record !== null,
      steps,
      finishedAt: record?.finishedAt ?? null,
      complete: record?.finishedAt != null && steps.every((step) => step.state !== "pending"),
    };
  }, database);
}

function group(
  kind: WeeklyResetSummary["groups"][number]["kind"],
  rows: WeeklyResetSummary["groups"][number]["rows"],
  total?: number,
) {
  return {
    kind,
    rows: rows.slice(0, LIMIT),
    more: rows.length > LIMIT || (total !== undefined && total > rows.length),
    ...(total === undefined ? {} : { total }),
  };
}

async function summary(
  db: D1ReadClient,
  auth: Authority,
  actor: D1WeeklyResetActor,
  scope: WeeklyResetScope,
  step: WeeklyResetStep,
  now: Date,
): Promise<WeeklyResetSummary> {
  const sections = weeklyResetSections(auth.user.role, auth.features);
  if (!sections.some((section) => section.id === step))
    throw new WeeklyResetError("STEP_UNAVAILABLE");
  const window = weeklyResetWindow(scope);
  const groups: WeeklyResetSummary["groups"] = [];
  const notes: WeeklyResetSummary["notes"] = [];

  if (step === "schedule") {
    notes.push("storedScheduleOnly");
    if (isFeatureEnabled(auth.features, "calendar")) {
      const rows = await db.event.findMany({
        where: {
          family_id: actor.familyId,
          start_time: { lt: window.instantEnd },
          end_time: { gt: window.instantStart },
        },
        select: { id: true, title: true, start_time: true, end_time: true },
        orderBy: [{ start_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push(group("events", rows.map((row) => ({
        title: short(row.title),
        when: iso(row.start_time),
        end: iso(row.end_time),
      }))));
    }
  }

  if (step === "responsibilities") {
    const showResponsibility = process.env.FAMILY_RESPONSIBILITY_READY === "1";
    if (!showResponsibility) notes.push("acceptanceAndBackupUnknown");
    if (isFeatureEnabled(auth.features, "chores")) {
      const rows = await db.chore.findMany({
        where: {
          family_id: actor.familyId,
          ...(auth.user.role === "parent"
            ? { assigned_to: { not: null } }
            : { assigned_to: actor.userId }),
          member_subject_erased: false,
          due_date: { gte: window.dateStart, lt: window.dateEnd },
          status: { in: ["pending", "in_progress", "overdue"] },
        },
        select: { id: true, title: true, due_date: true, assigned_to: true },
        orderBy: [{ due_date: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push(group("chores", rows.map((row) => ({
        ...(showResponsibility ? { responsibility: { kind: "chore" as const, id: row.id } } : {}),
        title: short(row.title),
        when: toDateOnlyUTC(row.due_date),
        owner: row.assigned_to === actor.userId ? "you" as const : "assigned" as const,
        ...(auth.user.role === "parent" && row.assigned_to ? { subjectKind: "account" as const } : {}),
      }))));
      notes.push("storedChoresOnly");
    }
    if (isFeatureEnabled(auth.features, "pickups")) {
      const rows = await db.pickup.findMany({
        where: { family_id: actor.familyId, completed: false, pickup_time: { gte: window.instantStart, lt: window.instantEnd } },
        select: { id: true, title: true, pickup_time: true, assigned_to: true },
        orderBy: [{ pickup_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push(group("pickups", rows.map((row) => ({
        ...(showResponsibility ? { responsibility: { kind: "pickup" as const, id: row.id } } : {}),
        title: short(row.title),
        when: iso(row.pickup_time),
        owner: row.assigned_to == null ? "unassigned" as const : row.assigned_to === actor.userId ? "you" as const : "assigned" as const,
      }))));
    }
    if (isFeatureEnabled(auth.features, "handoff")) {
      const rows = await db.handoff.findMany({
        where: { family_id: actor.familyId, arrival_time: { gte: window.instantStart, lt: window.instantEnd } },
        select: { id: true, sitter_name: true, arrival_time: true, departure_time: true },
        orderBy: [{ arrival_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push(group("handoffs", rows.map((row) => ({
        ...(showResponsibility && auth.user.role !== "child" ? { responsibility: { kind: "handoff" as const, id: row.id } } : {}),
        title: short(row.sitter_name), when: iso(row.arrival_time), end: iso(row.departure_time),
      }))));
    }
  }

  if (step === "meals") {
    const rows = await db.familyMeal.findMany({
      where: { family_id: actor.familyId, date: { gte: window.dateStart, lt: window.dateEnd } },
      select: { recipe_name: true, date: true },
      orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
      take: LIMIT + 1,
    });
    groups.push(group("meals", rows.map((row) => ({ title: short(row.recipe_name), when: toDateOnlyUTC(row.date) }))));
  }

  if (step === "prep") {
    if (!auth.user.email_verified) notes.push("prepRequiresVerifiedEmail");
    else {
      const sessions = await db.mealPrepSession.findMany({
        where: {
          family_id: actor.familyId,
          OR: [
            { prepared_on: { gte: window.dateStart, lt: window.dateEnd } },
            { prepared_at: { not: null }, prepared_on: { lt: window.dateEnd } },
            { next_prep_on: { gte: window.dateStart, lt: window.dateEnd } },
          ],
        },
        select: {
          prepared_on: true,
          next_prep_on: true,
          prepared_at: true,
          batches: { where: { family_id: actor.familyId }, orderBy: [{ position: "asc" }], take: LIMIT + 1, select: { id: true, name: true, total_servings: true } },
        },
        orderBy: [{ prepared_on: "desc" }, { id: "desc" }],
        take: LIMIT + 1,
      });
      const rows: WeeklyResetSummary["groups"][number]["rows"] = [];
      let more = sessions.length > LIMIT;
      for (const session of sessions.slice(0, LIMIT)) {
        more ||= session.batches.length > LIMIT;
        for (const batch of session.batches.slice(0, LIMIT)) {
          if (rows.length >= LIMIT) { more = true; break; }
          const consumption = await db.mealBatchConsumption.aggregate({
            where: { family_id: actor.familyId, batch_id: batch.id, cancelled_at: null },
            _sum: { servings: true },
          });
          const eaten = consumption._sum.servings ?? 0;
          if (!Number.isSafeInteger(eaten) || eaten < 0 || eaten > batch.total_servings)
            throw new WeeklyResetError("UNAVAILABLE");
          rows.push({ title: short(batch.name), when: toDateOnlyUTC(session.prepared_on), prepared: session.prepared_at !== null, quantity: batch.total_servings, eaten, ...(session.prepared_at ? { remaining: batch.total_servings - eaten } : {}), nextPrep: session.next_prep_on ? toDateOnlyUTC(session.next_prep_on) : null });
        }
      }
      groups.push({ kind: "prep", rows, more });
    }
  }

  if (step === "food") {
    const today = parseDateOnly(dayKeyFor({ kind: "tz", timeZone: scope.timeZone })(now));
    if (!today) throw new WeeklyResetError("UNAVAILABLE");
    const end = parseDateOnly(addDaysToKey(toDateOnlyUTC(today), 7));
    if (!end) throw new WeeklyResetError("UNAVAILABLE");
    const rows = await db.inventoryItem.findMany({
      where: { family_id: actor.familyId, status: "active", expires_on: { gte: today, lt: end } },
      select: { name: true, expires_on: true, date_kind: true },
      orderBy: [{ expires_on: "asc" }, { id: "asc" }],
      take: LIMIT + 1,
    });
    notes.push("currentFoodSnapshot");
    groups.push(group("food", rows.map((row) => ({ title: short(row.name), when: row.expires_on ? toDateOnlyUTC(row.expires_on) : null, dateKind: row.date_kind === "use_by" ? "use_by" as const : "best_before" as const }))));
  }

  if (step === "groceries") {
    const lists = await db.list.findMany({ where: { family_id: actor.familyId, type: "grocery" }, select: { id: true }, orderBy: [{ id: "asc" }] });
    const listIds = lists.map((list) => list.id);
    const rows = listIds.length ? await db.listItem.findMany({ where: { list_id: { in: listIds }, checked: false }, select: { content: true, quantity: true }, orderBy: [{ position: "asc" }, { id: "asc" }], take: LIMIT + 1 }) : [];
    const total = listIds.length ? await db.listItem.count({ where: { list_id: { in: listIds }, checked: false } }) : 0;
    groups.push(group("groceries", rows.map((row) => ({ title: short(row.content), when: null, quantity: row.quantity })), total));
    notes.push("groceryGapsNotAssessed");
  }

  return weeklyResetSummary.parse({
    protocol: WEEKLY_RESET_PROTOCOL,
    owner: { userId: actor.userId, familyId: actor.familyId },
    scope,
    step,
    generatedAt: now.toISOString(),
    groups,
    notes,
  });
}

export function readD1WeeklyResetSummary(
  actor: D1WeeklyResetActor,
  scope: WeeklyResetScope,
  step: WeeklyResetStep,
  now = new Date(),
  database?: D1Store,
) {
  return readWithAuthority(actor, (db, auth) => summary(db, auth, actor, scope, step, now), database);
}

export function writeD1WeeklyReset(
  actor: D1WeeklyResetActor,
  command: WeeklyResetCommand,
  key: string,
  database?: D1Store,
  now = new Date(),
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: { ...actor, generation: actor.tokenVersion },
    action: "weekly-reset.progress.v1",
    input: command,
    key,
    database,
    authorize: (db) => authority(db, actor).then(() => null),
    plan: async (db) => {
      const auth = await authority(db, actor);
      if (command.userId !== actor.userId || command.familyId !== actor.familyId)
        return failure(403, "Forbidden");
      if (auth.user.weekly_reset_revision !== command.expectedRevision)
        throw new WeeklyResetError("CONFLICT");
      const age = now.getTime() - Date.parse(command.issuedAt);
      if (age > 15 * 60_000 || age < -60_000) throw new WeeklyResetError("CONFLICT");
      const current = storedRecord(auth.user);
      const next = planWeeklyReset(current, command, auth.user.role, auth.features, now);
      const changed = JSON.stringify(current) !== JSON.stringify(next);
      if (changed && auth.user.weekly_reset_revision >= 2147483647)
        throw new WeeklyResetError("CONFLICT");
      const revision = auth.user.weekly_reset_revision + (changed ? 1 : 0);
      const body = weeklyResetReceipt.parse({ receipt: {
        protocol: WEEKLY_RESET_PROTOCOL,
        familyId: actor.familyId,
        userId: actor.userId,
        weekStart: command.weekStart,
        timeZone: command.timeZone,
        action: command.action,
        revision,
      } });
      return {
        status: 200,
        body,
        effects: (session: Pick<D1Store, "prepare">) => changed ? [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3 AND weekly_reset_revision=?4)`, [actor.userId, actor.familyId, actor.tokenVersion, command.expectedRevision]),
          session.prepare(`UPDATE "User" SET weekly_reset_progress=?1, weekly_reset_revision=weekly_reset_revision+1 WHERE id=?2 AND family_id=?3 AND token_version=?4 AND weekly_reset_revision=?5`).bind(JSON.stringify(next), actor.userId, actor.familyId, actor.tokenVersion, command.expectedRevision),
          d1WriteCheck(session, "changes()=1"),
        ] : [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3 AND weekly_reset_revision=?4)`, [actor.userId, actor.familyId, actor.tokenVersion, command.expectedRevision]),
        ],
      };
    },
  });
}

function parseStoredResponse(value: unknown) {
  return typeof value === "string" ? jsonObject(value) : value;
}

export function reviewD1WeeklyResetRequest(
  actor: D1WeeklyResetActor,
  entry: WeeklyResetRecoveryEntry,
  ownerScope: string,
  enabled: boolean,
  now = new Date(),
  database?: D1Store,
) {
  return readWithAuthority(actor, async (db, auth) => {
    let command: WeeklyResetCommand;
    try { command = JSON.parse(entry.body); } catch { throw new WeeklyResetError("CONFLICT"); }
    const parsed = (await import("@/lib/weekly-reset")).weeklyResetCommand.safeParse(command);
    if (!parsed.success) throw new WeeklyResetError("CONFLICT");
    command = parsed.data;
    if (command.userId !== actor.userId || command.familyId !== actor.familyId)
      throw new WeeklyResetError("FORBIDDEN");
    const record = await db.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `user:${actor.userId}`, key: entry.key } },
      select: { family_id: true, user_id: true, action: true, request_hash: true, response_status: true, response_body: true },
    });
    if (record && (record.family_id !== actor.familyId || record.user_id !== actor.userId || record.action !== "weekly-reset.progress.v1" || record.request_hash !== hashIdempotentRequest("weekly-reset.progress.v1", command)))
      throw new WeeklyResetError("CONFLICT");
    const reply = (state: "ready" | "pending" | "committed" | "expired" | "conflict" | "paused" | "unavailable", receipt: unknown = null) => weeklyResetRecoveryReview.parse({ contract: WEEKLY_RESET_RECOVERY, ownerScope, entry, state, canRetry: state === "ready" || state === "pending", currentRevision: auth.user.weekly_reset_revision, receipt });
    if (record?.response_status != null) {
      const proof = weeklyResetReceipt.safeParse(parseStoredResponse(record.response_body));
      return proof.success && record.response_status === 200 ? reply("committed", proof.data) : reply("unavailable");
    }
    const age = now.getTime() - Date.parse(command.issuedAt);
    if (age > 15 * 60_000 || age < -60_000) return reply("expired");
    if (auth.user.weekly_reset_revision !== command.expectedRevision) return reply("conflict");
    const current = auth.user.weekly_reset_progress == null ? null : weeklyResetRecord.safeParse(jsonObject(auth.user.weekly_reset_progress));
    if (current && !current.success) return reply("unavailable");
    try { planWeeklyReset(current?.data ?? null, command, auth.user.role, auth.features, now); }
    catch { return reply("conflict"); }
    return reply(enabled ? (record ? "pending" : "ready") : "paused");
  }, database);
}
