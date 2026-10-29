/** Native D1 future-routine catalog/state/command adapter.
 *
 * The existing PostgreSQL coordinator remains the compatibility implementation.
 * This module deliberately keeps all source reads behind the read client and
 * repeats them as native write assertions before one D1 batch.  D1 interactive
 * transactions are not used.
 */
import { createHash, randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { IDEMPOTENCY_TTL_MS, IDEMPOTENCY_LOCK_TIMEOUT_MS } from "@/lib/idempotency-key";
import {
  routineScheduleCatalog,
  routineScheduleState,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";
import {
  normalizeRoutineSharedSchedule,
  routineScheduleCommand,
  routineScheduleConfig,
  routineScheduleReceipt,
  routineStepSeriesConfig,
  routineViewerDay,
  validateRoutineStepTransition,
  firstRoutineOccurrence,
  type RoutineScheduleCommand,
  type RoutineScheduleConfig,
  type RoutineStepSeriesConfig,
} from "@/lib/routine-schedule";
import type { RoutineScheduleActor } from "@/lib/routine-schedule-runtime";
import { isProfileChoreEnabled, isProfileChoreRecurrenceSupported } from "@/lib/profile-chore-gates";
import { profileRoleSchema, isProfileAgeAllowed } from "@/lib/member-subject-contract";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

type Actor = RoutineScheduleActor;
const ROUTINE_SCHEDULE_ACTION = "routine.schedule.v1";
type StackRow = { id: string; family_id: string; label: string; version: number; fingerprint: string; schedule_config: unknown };
type RootRow = {
  id: string; family_id: string; title: string; description: string | null;
  points: number; difficulty: string; icon: string | null; assigned_to: string | null;
  assigned_member_id: string | null; member_subject_erased: boolean; due_date: Date;
  recurrence_id: string | null; is_template: boolean; frequency: string;
  weekly_days: unknown; routine: string | null; routine_order: number | null;
  routine_stack_id: string | null; routine_anchor: string | null;
  routine_duration_minutes: number | null; routine_series_config: unknown;
};
type OccurrenceRow = {
  id: string; recurrence_id: string | null; routine_stack_id: string | null;
  due_date: Date; status: string; photo_url: string | null; photo_verified: boolean;
  verified_at: Date | null; verified_notes: string | null; completed_at: Date | null;
  successor_id: string | null; is_template: boolean; member_subject_erased: boolean;
};
type Receipt = { id: string; family_id: string; user_id: string | null; action: string; request_hash: string; created_at: number | null; response_status: number | null; response_body: string | null; expires_at: number };
class RoutineReceiptReuseError extends Error {}

const fail = (status: number, code: string): EffectResult => ({ status, body: { error: { code } } });
const parseJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
};
const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const json = (value: unknown) => JSON.stringify(value);
const days = (value: unknown): number[] => {
  const parsed = parseJson<unknown>(value);
  return Array.isArray(parsed) && parsed.every((item) => Number.isInteger(item)) ? parsed as number[] : [];
};

function authority(db: D1ReadClient, actor: Actor) {
  return Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
}
function validActor(user: { family_id: string | null; role: string; token_version: number } | null, family: { features: unknown } | null, actor: Actor) {
  if (!user || user.family_id !== actor.familyId || user.role !== "parent" || user.token_version !== actor.tokenVersion || !family) return false;
  const features = parseJson<Record<string, unknown>>(family.features) ?? {};
  return features.chores !== false;
}

function subjectOk(db: D1ReadClient, actor: Actor, subject: RoutineStepSeriesConfig["content"]["subject"], repeating: boolean) {
  if (subject.kind === "erased") return Promise.resolve(false);
  if (subject.kind === "account") {
    return Promise.all([
      db.user.findFirst({ where: { id: subject.user_id, family_id: actor.familyId }, select: { id: true } }),
      subject.member_id
        ? db.householdMember.findFirst({ where: { id: subject.member_id, family_id: actor.familyId }, select: { id: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } })
        : Promise.resolve(null),
    ]).then(([user, member]) => Boolean(user) && (!subject.member_id || Boolean(member && !member.archived_at && !member.erasure_user_id && (member.account_link?.user_id === subject.user_id || member.legacy_mapping?.user_id === subject.user_id))));
  }
  if (actor.memberProtocol !== 2 || !isProfileChoreEnabled() || (repeating && !isProfileChoreRecurrenceSupported())) return Promise.resolve(false);
  return db.householdMember.findFirst({ where: { id: subject.member_id, family_id: actor.familyId }, select: { id: true, role: true, age: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } }).then((member) => {
    if (!member || member.archived_at || member.erasure_user_id || member.legacy_mapping || member.account_link) return false;
    const role = profileRoleSchema.safeParse(member.role);
    return role.success && isProfileAgeAllowed(role.data, member.age);
  });
}

async function captureState(db: D1ReadClient, actor: Actor, stackId: string | null, rootIds: string[]) {
  const [user, family] = await authority(db, actor);
  if (!validActor(user, family, actor)) return { denied: true as const, family, stack: null, roots: [], rows: [] };
  const stack = stackId ? await db.routineStack.findFirst({ where: { id: stackId, family_id: actor.familyId }, select: { id: true, family_id: true, label: true, version: true, fingerprint: true, schedule_config: true } }) : null;
  const configuredIds = stack ? routineScheduleConfig.safeParse(stack.schedule_config).success ? routineScheduleConfig.parse(stack.schedule_config).steps.map((step) => step.template_id) : [] : [];
  const selectedRootIds = rootIds.length ? rootIds : configuredIds;
  const roots = selectedRootIds.length ? await db.chore.findMany({ where: { family_id: actor.familyId, id: { in: selectedRootIds } }, select: { id: true, family_id: true, title: true, description: true, points: true, difficulty: true, icon: true, assigned_to: true, assigned_member_id: true, member_subject_erased: true, due_date: true, recurrence_id: true, is_template: true, frequency: true, weekly_days: true, routine: true, routine_order: true, routine_stack_id: true, routine_anchor: true, routine_duration_minutes: true, routine_series_config: true }, orderBy: { id: "asc" } }) : [];
  const rows = selectedRootIds.length ? await db.chore.findMany({ where: { family_id: actor.familyId, recurrence_id: { in: selectedRootIds } }, select: { id: true, recurrence_id: true, routine_stack_id: true, due_date: true, status: true, photo_url: true, photo_verified: true, verified_at: true, verified_notes: true, completed_at: true, successor_id: true, is_template: true, member_subject_erased: true }, orderBy: [{ recurrence_id: "asc" }, { due_date: "asc" }, { id: "asc" }], take: 10001 }) : [];
  return { denied: false as const, family, stack: stack as StackRow | null, roots: roots as RootRow[], rows: rows as OccurrenceRow[] };
}

function rootDefinition(row: RootRow): RoutineStepSeriesConfig | null { return routineStepSeriesConfig.safeParse(parseJson(row.routine_series_config)).success ? routineStepSeriesConfig.parse(parseJson(row.routine_series_config)) : null; }
function untouched(row: OccurrenceRow) { return row.status === "pending" && !row.photo_url && !row.photo_verified && !row.verified_at && !row.verified_notes && !row.completed_at && !row.successor_id && !row.member_subject_erased && !row.is_template; }

function fingerprint(label: string, version: number, config: unknown) { return createHash("sha256").update(JSON.stringify({ label, version, config })).digest("hex"); }
function receiptBody(value: string | null) { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }
function receiptExpired(row: Pick<Receipt, "created_at" | "expires_at"> | null, now: number) {
  return Boolean(row && (row.expires_at <= now || row.created_at == null));
}

async function existingReceipt(store: D1Store, actor: Actor, key: string, action: string, requestHash: string, now: number) {
  return store.withSession("first-primary").prepare(`SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, key).first<Receipt>().then((row) => {
    if (!row) return null;
    if (!receiptExpired(row, now) && (row.family_id !== actor.familyId || row.user_id !== actor.userId || row.action !== action || row.request_hash !== requestHash)) throw new RoutineReceiptReuseError("IDEMPOTENCY_KEY_REUSED");
    return row;
  });
}

async function captureRoutineAuthority(store: D1Store, actor: Actor) {
  return captureD1Reads(async (db) => {
    const [user, family] = await authority(db, actor);
    return validActor(user, family, actor);
  }, store as unknown as NativeD1);
}

function sourceChecks(session: Pick<D1Store, "prepare">, actor: Actor, state: Awaited<ReturnType<typeof captureState>>, stackId: string | null, stack: StackRow | null, roots: RootRow[], rows: OccurrenceRow[]) {
  const checks = [d1WriteCheck(session, `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.tokenVersion]), d1WriteCheck(session, `EXISTS(SELECT 1 FROM "Family" WHERE id=?1 AND COALESCE(json_extract(features,'$.chores'),1)<>0)`, [actor.familyId])];
  if (stackId && stack) checks.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "RoutineStack" WHERE id=?1 AND family_id=?2 AND label=?3 AND version=?4 AND fingerprint=?5 AND schedule_config IS ?6)`, [stack.id, actor.familyId, stack.label, stack.version, stack.fingerprint, json(stack.schedule_config)]));
  for (const root of roots) checks.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND due_date=?3 AND recurrence_id=id AND routine_series_config IS ?4 AND routine_stack_id IS ?5)`, [root.id, actor.familyId, root.due_date.getTime(), json(root.routine_series_config), root.routine_stack_id]));
  for (const row of rows) checks.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND due_date=?3 AND status=?4 AND routine_stack_id IS ?5 AND recurrence_id IS ?6)`, [row.id, actor.familyId, row.due_date.getTime(), row.status, row.routine_stack_id, row.recurrence_id]));
  return checks;
}

export async function readD1RoutineScheduleCatalog(actor: Actor, cursor: string | null, database?: D1Store): Promise<EffectResult> {
  if (cursor !== null && (!cursor || cursor.length > 128)) return fail(400, "INVALID_QUERY");
  const store = database ?? await getD1Database();
  const capture = await captureD1Reads(async (db) => {
    const [user, family] = await authority(db, actor);
    if (!validActor(user, family, actor)) return null;
    const stacks = await db.routineStack.findMany({ where: { family_id: actor.familyId, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, label: true, version: true, schedule_config: true }, orderBy: { id: "asc" }, take: 21 });
    const users = await db.user.findMany({ where: { family_id: actor.familyId }, select: { id: true, name: true, role: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 });
    const profiles = actor.memberProtocol === 2 && isProfileChoreEnabled() ? await db.householdMember.findMany({ where: { family_id: actor.familyId, archived_at: null, erasure_user_id: null, legacy_mapping: { is: null }, account_link: { is: null } }, select: { id: true, name: true, role: true, age: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 }) : [];
    return { user, family, stacks, users, profiles };
  }, store as unknown as NativeD1);
  if (!capture.value) return fail(403, "ROUTINE_PARENT_REQUIRED");
  const value = capture.value;
  if (value.users.length + value.profiles.length > 1000) return fail(409, "ROUTINE_MEMBERS_REQUIRE_REVIEW");
  const assignments: RoutineAssignmentOption[] = value.users.map((row) => ({ subject: { kind: "account", user_id: row.id, member_id: null }, name: row.name, role: row.role, canRepeat: true }));
  for (const row of value.profiles) {
    const role = profileRoleSchema.safeParse(row.role);
    if (role.success && isProfileAgeAllowed(role.data, row.age)) assignments.push({ subject: { kind: "profile", member_id: row.id }, name: row.name, role: row.role, canRepeat: isProfileChoreRecurrenceSupported() });
  }
  const scheduled = value.stacks.filter((row) => row.schedule_config !== null);
  const page = scheduled.slice(0, 20);
  return { status: 200, body: routineScheduleCatalog.parse({ protocol: "herewoven.routine-schedule.v1", userId: actor.userId, familyId: actor.familyId, pointsEnabled: Boolean((parseJson<Record<string, unknown>>(value.family!.features) ?? {}).gamification), routines: page.map((row) => { const parsed = routineScheduleConfig.safeParse(row.schedule_config); return { stackId: row.id, label: row.label, version: row.version, state: parsed.success ? parsed.data.state : "unsupported", schedule: parsed.success ? parsed.data.schedule : null, stepCount: parsed.success ? parsed.data.steps.length : null }; }), nextCursor: scheduled.length > 20 ? page.at(-1)!.id : null, assignments }) };
}

export async function readD1RoutineSchedule(actor: Actor, stackId: string, database?: D1Store): Promise<EffectResult> {
  const store = database ?? await getD1Database();
  const capture = await captureD1Reads(async (db) => {
    const state = await captureState(db, actor, stackId, []);
    if (state.denied || !state.stack) return null;
    const config = routineScheduleConfig.safeParse(state.stack.schedule_config);
    if (!config.success) return { state, config: null, roots: [] };
    const roots = await db.chore.findMany({ where: { family_id: actor.familyId, id: { in: config.data.steps.map((step) => step.template_id) } }, select: { id: true, title: true, description: true, assigned_to: true, assigned_member_id: true, points: true, difficulty: true, icon: true, routine: true, routine_order: true, routine_series_config: true, routine_anchor: true, routine_duration_minutes: true }, orderBy: { id: "asc" } });
    return { state, config: config.data, roots };
  }, store as unknown as NativeD1);
  if (!capture.value) return fail(404, "ROUTINE_SCHEDULE_UNAVAILABLE");
  if (!capture.value.config) return fail(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
  const config = capture.value.config, byId = new Map(capture.value.roots.map((row) => [row.id, row]));
  const pointsEnabled = Boolean((parseJson<Record<string, unknown>>(capture.value.state.family?.features) ?? {}).gamification);
  const steps = config.steps.map((step) => { const row = byId.get(step.template_id); const definition = row ? routineStepSeriesConfig.safeParse(row.routine_series_config) : null; const content = definition?.success ? definition.data.content : null; return { template_id: step.template_id, title: content?.title ?? row?.title ?? "", description: content?.description ?? row?.description ?? null, subject: content?.subject ?? (row?.assigned_to ? { kind: "account" as const, user_id: row.assigned_to, member_id: row.assigned_member_id } : null), points: pointsEnabled ? (content?.points ?? row?.points ?? 0) : undefined, difficulty: content?.difficulty ?? row?.difficulty ?? "medium", icon: content?.icon ?? row?.icon ?? null, duration_minutes: content?.duration_minutes ?? row?.routine_duration_minutes ?? null }; });
  return { status: 200, body: routineScheduleState.parse({ protocol: "herewoven.routine-schedule.v1", userId: actor.userId, familyId: actor.familyId, stackId, version: capture.value.state.stack!.version, label: capture.value.state.stack!.label, pointsEnabled, config, steps }) };
}

function rootInsert(session: Pick<D1Store, "prepare">, actor: Actor, id: string, step: { title: string; description: string | null; subject: { kind: "account"; user_id: string; member_id: string | null } | { kind: "profile"; member_id: string }; points: number; difficulty: string; icon: string | null; duration_minutes: number | null }, schedule: ReturnType<typeof normalizeRoutineSharedSchedule>, stackId: string, label: string, order: number, anchor: string | null, now: number) {
  const account = step.subject.kind === "account" ? step.subject.user_id : null, member = step.subject.kind === "account" ? step.subject.member_id : step.subject.member_id;
  const due = firstRoutineOccurrence(schedule, schedule.starts_on!, schedule.starts_on!);
  const definition = { protocol: "herewoven.routine-step-series.v1", revision: 1, once_pending: schedule.frequency === "once", anchor_retired: false, stack_id: stackId, state: "active", effective_on: schedule.starts_on!, anchor, schedule, content: { title: step.title, description: step.description, subject: step.subject, points: step.points, difficulty: step.difficulty, icon: step.icon, duration_minutes: step.duration_minutes } };
  return session.prepare(`INSERT INTO "Chore" (id,family_id,created_by,title,description,points,assigned_to,assigned_member_id,due_date,frequency,difficulty,icon,created_at,recurrence_id,is_template,routine_stack_id,routine_anchor,routine_duration_minutes,routine_series_config,routine,routine_order,weekly_days) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?1,?14,?15,?16,?17,?18,?19,?20,?21)`).bind(id, actor.familyId, actor.userId, step.title, step.description, step.points, account, member, Date.parse(`${due}T00:00:00Z`), schedule.frequency, step.difficulty, step.icon, now, schedule.frequency !== "once" ? 1 : 0, stackId, anchor, step.duration_minutes, json(definition), label, order, json(schedule.weekly_days));
}

export async function saveD1RoutineSchedule(actor: Actor, raw: unknown, key: string, now = new Date(), database?: D1Store, writesEnabled = true): Promise<EffectResult> {
  const input = routineScheduleCommand.parse(raw), requestHash = hashIdempotentRequest(ROUTINE_SCHEDULE_ACTION, input), store = database ?? await getD1Database(), session = store.withSession("first-primary");
  if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId) return fail(403, "AUTH_CONTEXT_CHANGED");
  const authority = await captureRoutineAuthority(store, actor);
  if (!authority.value) return fail(403, "ROUTINE_PARENT_REQUIRED");
  let receipt: Receipt | null;
  try { receipt = await existingReceipt(store, actor, key, ROUTINE_SCHEDULE_ACTION, requestHash, now.getTime()); }
  catch (error) { if (error instanceof RoutineReceiptReuseError) return fail(422, "IDEMPOTENCY_KEY_REUSED"); throw error; }
  let expired = receiptExpired(receipt, now.getTime());
  if (!expired && receipt?.response_status !== null && receipt?.response_status !== undefined) {
    // Re-check the current user, token generation, household and feature gate
    // in the same native session immediately before returning private data.
    await session.batch(authority.checks(session));
    const proof = routineScheduleReceipt.safeParse(receiptBody(receipt.response_body));
    return proof.success ? { status: receipt.response_status, body: proof.data } : fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
  }
  if (!expired && receipt?.response_status === null && receipt.created_at != null && receipt.created_at > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS) return fail(409, "IDEMPOTENCY_IN_PROGRESS");
  if (!writesEnabled) return fail(409, "ROUTINE_SCHEDULE_PAUSED");
  if (routineViewerDay(input.view_zone, now) !== input.view_day || now.getTime() - Date.parse(input.issued_at) > 15 * 60_000 || now.getTime() - Date.parse(input.issued_at) < -60_000) return fail(409, "ROUTINE_INTENT_EXPIRED");
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const rootIds = input.action === "create" ? [] : input.action === "replace-future" ? input.steps.flatMap((step) => step.template_id ? [step.template_id] : []).concat(input.removed_steps.map((step) => step.template_id)) : [];
      const capture = await captureD1Reads(async (db) => {
        const state = await captureState(db, actor, input.action === "create" ? null : input.stack_id, rootIds);
        let subjectsValid = true;
        if (!state.denied && (input.action === "create" || input.action === "replace-future" || input.action === "resume")) {
          const existing = state.stack ? routineScheduleConfig.safeParse(state.stack.schedule_config) : null;
          const schedule = input.action === "create" || input.action === "replace-future"
            ? normalizeRoutineSharedSchedule(input.schedule, input.view_day)
            : existing?.success ? existing.data.schedule : null;
          const subjects = input.action === "create" || input.action === "replace-future"
            ? input.steps.map((step) => step.subject)
            : existing?.success ? existing.data.steps.flatMap((step) => {
                const row = state.roots.find((root) => root.id === step.template_id), definition = row ? rootDefinition(row) : null;
                return definition ? [definition.content.subject] : [];
              }) : [];
          subjectsValid = Boolean(schedule) && (await Promise.all(subjects.map((subject) => subjectOk(db, actor, subject, schedule!.frequency !== "once")))).every(Boolean);
        }
        return { state, subjectsValid };
      }, store as unknown as NativeD1);
      const state = capture.value.state;
      if (state.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
      if (state.rows.length > 10000) return fail(409, "ROUTINE_REVIEW_TOO_LARGE");
      if (!capture.value.subjectsValid) return fail(409, "ROUTINE_SUBJECT_UNAVAILABLE");
      if (input.action !== "create" && !state.stack) return fail(404, "ROUTINE_SCHEDULE_UNAVAILABLE");
      if (input.action !== "create" && state.stack!.version !== input.expected_version) return fail(409, "ROUTINE_VERSION_CONFLICT");
      if (state.stack && !routineScheduleConfig.safeParse(state.stack.schedule_config).success) return fail(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
      const oldConfig = state.stack ? routineScheduleConfig.parse(state.stack.schedule_config) : null;
      if (input.action !== "create") {
        const configuredIds = oldConfig!.steps.map((step) => step.template_id);
        if (state.roots.length !== configuredIds.length || state.roots.some((root) => {
          if (!configuredIds.includes(root.id)) return true;
          const definition = rootDefinition(root);
          return root.recurrence_id !== root.id || root.routine_stack_id !== state.stack!.id || !definition || definition.stack_id !== state.stack!.id || definition.state !== oldConfig!.state || definition.effective_on !== oldConfig!.effective_on || definition.anchor !== oldConfig!.anchor || JSON.stringify(definition.schedule) !== JSON.stringify(oldConfig!.schedule);
        })) return fail(409, "ROUTINE_ROOT_UNAVAILABLE");
      }
      if (oldConfig?.state === "stopped") return fail(409, "ROUTINE_STOPPED");
      if (input.action === "pause" && oldConfig?.state !== "active") return fail(409, "ROUTINE_STATE_CONFLICT");
      if (input.action === "resume" && oldConfig?.state !== "paused") return fail(409, "ROUTINE_STATE_CONFLICT");
      const schedule = input.action === "create" || input.action === "replace-future" ? normalizeRoutineSharedSchedule(input.schedule, input.view_day) : normalizeRoutineSharedSchedule(oldConfig!.schedule, input.view_day);
      if (input.action === "create" && schedule.starts_on! < input.view_day) return fail(400, "ROUTINE_START_IN_PAST");
      if (input.action === "resume" && schedule.frequency === "once" && schedule.starts_on! <= input.view_day) return fail(409, "ROUTINE_ONCE_ALREADY_PASSED");
      if (input.action === "replace-future" && oldConfig) {
        try { validateRoutineStepTransition(oldConfig, input); } catch { return fail(409, "ROUTINE_STEPS_CHANGED"); }
      }
      const oldRoots = state.roots;
      const oldById = new Map(oldRoots.map((row) => [row.id, row]));
      const candidatesInput = input.action === "create" || input.action === "replace-future" ? input.steps : oldConfig!.steps.map((step) => { const row = oldById.get(step.template_id), definition = row && rootDefinition(row); return { client_step_id: step.template_id, template_id: step.template_id, title: definition?.content.title ?? row?.title ?? "", description: definition?.content.description ?? row?.description ?? null, subject: definition?.content.subject && definition.content.subject.kind !== "erased" ? definition.content.subject : (row?.assigned_to ? { kind: "account" as const, user_id: row.assigned_to, member_id: row.assigned_member_id } : { kind: "profile" as const, member_id: row?.assigned_member_id ?? "" }), points: definition?.content.points ?? row?.points ?? 0, difficulty: definition?.content.difficulty ?? row?.difficulty ?? "medium", icon: definition?.content.icon ?? row?.icon ?? null, duration_minutes: definition?.content.duration_minutes ?? row?.routine_duration_minutes ?? null }; });
      const pointsEnabled = Boolean((parseJson<Record<string, unknown>>(state.family?.features) ?? {}).gamification);
      const candidates = candidatesInput.map((candidate) => ({
        ...candidate,
        points: pointsEnabled
          ? candidate.points ?? (candidate.template_id ? rootDefinition(oldById.get(candidate.template_id) ?? ({} as RootRow))?.content.points ?? 0 : 0)
          : candidate.template_id ? rootDefinition(oldById.get(candidate.template_id) ?? ({} as RootRow))?.content.points ?? 0 : 0,
      }));
      const stackId = state.stack?.id ?? randomUUID(), version = state.stack ? state.stack.version + 1 : 1, stateName = input.action === "pause" ? "paused" : input.action === "stop" ? "stopped" : input.action === "resume" ? "active" : oldConfig?.state ?? "active", effective = input.action === "create" ? input.view_day : new Date(`${input.view_day}T00:00:00Z`).toISOString().slice(0, 10);
      const roots = candidates.map((step, index) => ({ ...step, template_id: step.template_id ?? randomUUID(), index }));
      const config = routineScheduleConfig.parse({ protocol: "herewoven.routine-schedule.v1", state: stateName, effective_on: effective, anchor: input.action === "create" || input.action === "replace-future" ? input.anchor : oldConfig!.anchor, schedule, steps: roots.map((step) => ({ template_id: step.template_id })) });
      let prunedCount = 0, unstackedCount = 0;
      const statements = [...sourceChecks(session, actor, state, stackId, state.stack, state.roots, state.rows)];
      if (input.action !== "create" && state.stack) {
        const removed = input.action === "replace-future" ? new Map(input.removed_steps.map((step) => [step.template_id, step.disposition])) : new Map<string, "unstack-future" | "stop-future">();
        const futureByRoot = new Map<string, OccurrenceRow[]>();
        for (const row of state.rows) {
          if (row.due_date.toISOString().slice(0, 10) <= input.view_day || !untouched(row) || !row.recurrence_id) continue;
          const rowsForRoot = futureByRoot.get(row.recurrence_id) ?? [];
          rowsForRoot.push(row);
          futureByRoot.set(row.recurrence_id, rowsForRoot);
        }
        for (const [rootId, future] of futureByRoot) {
          const disposition = removed.get(rootId);
          if (disposition === "unstack-future") {
            statements.push(session.prepare(`UPDATE "Chore" SET routine_stack_id=NULL,routine=NULL,routine_order=NULL WHERE family_id=?1 AND recurrence_id=?2 AND routine_stack_id=?3 AND id IN (SELECT value FROM json_each(?4))`).bind(actor.familyId, rootId, stackId, json(future.map((row) => row.id))), d1WriteCheck(session, `changes()=?1`, [future.length]));
            unstackedCount += future.length;
          } else {
            statements.push(session.prepare(`DELETE FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2 AND routine_stack_id=?3 AND id IN (SELECT value FROM json_each(?4))`).bind(actor.familyId, rootId, stackId, json(future.map((row) => row.id))), d1WriteCheck(session, `changes()=?1`, [future.length]));
            prunedCount += future.length;
          }
        }
      }
      let receiptId = expired ? randomUUID() : receipt?.id ?? randomUUID();
      const body = routineScheduleReceipt.parse({ protocol: "herewoven.routine-schedule.v1", requestId: receiptId, stackId, version, action: input.action, state: stateName, roots: roots.map((step) => step.template_id), prunedCount, unstackedCount });
      if (receipt && !expired) statements.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND response_status IS NULL AND created_at<=?2)`, [receipt.id, now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS]));
      else {
        if (receipt && expired) statements.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND (expires_at<=?2 OR created_at IS NULL))`, [receipt.id, now.getTime()]), session.prepare(`DELETE FROM "IdempotencyRecord" WHERE id=?1`).bind(receipt.id));
        receiptId = body.requestId;
        const expiresAt = now.getTime() + IDEMPOTENCY_TTL_MS;
        statements.push(d1WriteCheck(session, `NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)`, [`user:${actor.userId}`, key]), session.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(receiptId, `user:${actor.userId}`, key, actor.familyId, actor.userId, ROUTINE_SCHEDULE_ACTION, requestHash, now.getTime(), expiresAt)); }
      if (!state.stack) statements.push(session.prepare(`INSERT INTO "RoutineStack" (id,family_id,label,version,fingerprint,created_by,created_at,updated_at,schedule_config) VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8)`).bind(stackId, actor.familyId, input.action === "create" || input.action === "replace-future" ? input.label : "Routine", version, fingerprint(input.action === "create" || input.action === "replace-future" ? input.label : "Routine", version, config), actor.userId, now.getTime(), json(config)));
      else statements.push(session.prepare(`UPDATE "RoutineStack" SET label=?1,version=?2,fingerprint=?3,schedule_config=?4,updated_at=?5 WHERE id=?6 AND family_id=?7`).bind(input.action === "create" || input.action === "replace-future" ? input.label : state.stack.label, version, fingerprint(input.action === "create" || input.action === "replace-future" ? input.label : state.stack.label, version, config), json(config), now.getTime(), stackId, actor.familyId));
      if (input.action === "replace-future" && oldConfig) {
        for (const removed of input.removed_steps) {
          const row = oldById.get(removed.template_id), definition = row && rootDefinition(row);
          if (!row || !definition) continue;
          const next = { ...definition, revision: definition.revision + 1, stack_id: null, state: removed.disposition === "unstack-future" ? "active" : "stopped", effective_on: effective };
          statements.push(session.prepare(`UPDATE "Chore" SET routine_series_config=?1,frequency=?2,weekly_days=?3,is_template=?4,routine_stack_id=NULL,routine_anchor=?5,routine_duration_minutes=?6 WHERE id=?7 AND family_id=?8 AND recurrence_id=id`).bind(json(next), next.schedule.frequency, json(next.schedule.weekly_days), next.state !== "stopped" && next.schedule.frequency !== "once" ? 1 : 0, next.anchor, next.content.duration_minutes, row.id, actor.familyId), d1WriteCheck(session, `changes()=1`, []));
        }
      }
      for (const step of roots) {
        const id = step.template_id, old = oldById.get(id), def = { protocol: "herewoven.routine-step-series.v1", revision: (rootDefinition(old ?? ({} as RootRow))?.revision ?? 0) + 1, once_pending: schedule.frequency === "once", anchor_retired: false, stack_id: stackId, state: stateName, effective_on: effective, anchor: config.anchor, schedule, content: { title: step.title, description: step.description, subject: step.subject, points: step.points ?? 0, difficulty: step.difficulty, icon: step.icon ?? null, duration_minutes: step.duration_minutes ?? null } };
        if (old) statements.push(session.prepare(`UPDATE "Chore" SET routine_series_config=?1,frequency=?2,weekly_days=?3,is_template=?4,routine_stack_id=?5,routine_anchor=?6,routine_duration_minutes=?7,routine=?8,routine_order=?9 WHERE id=?10 AND family_id=?11`).bind(json(def), schedule.frequency, json(schedule.weekly_days), schedule.frequency !== "once" && stateName !== "stopped" ? 1 : 0, stackId, config.anchor, step.duration_minutes ?? null, input.action === "create" || input.action === "replace-future" ? input.label : state.stack?.label ?? null, step.index + 1, id, actor.familyId));
        else statements.push(rootInsert(session, actor, id, step as never, schedule, stackId, input.action === "create" || input.action === "replace-future" ? input.label : "Routine", step.index + 1, config.anchor, now.getTime()));
      }
      statements.push(session.prepare(`UPDATE "IdempotencyRecord" SET response_status=?1,response_body=?2 WHERE id=?3 AND response_status IS NULL`).bind(input.action === "create" ? 201 : 200, json(body), receiptId));
      await session.batch(statements);
      return { status: input.action === "create" ? 201 : 200, body };
    } catch (error) {
      if (isD1WriteConflict(error) || (error instanceof Error && /UNIQUE|constraint/i.test(error.message))) {
        try { receipt = await existingReceipt(store, actor, key, ROUTINE_SCHEDULE_ACTION, requestHash, now.getTime()); }
        catch (caught) { if (caught instanceof RoutineReceiptReuseError) return fail(422, "IDEMPOTENCY_KEY_REUSED"); throw caught; }
        expired = receiptExpired(receipt, now.getTime());
        if (!expired && receipt?.response_status != null) {
          const live = await captureRoutineAuthority(store, actor);
          if (!live.value) return fail(403, "ROUTINE_PARENT_REQUIRED");
          await session.batch(live.checks(session));
          const proof = routineScheduleReceipt.safeParse(receiptBody(receipt.response_body));
          return proof.success ? { status: receipt.response_status, body: proof.data } : fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
        }
        continue;
      }
      throw error;
    }
  }
  return fail(409, "ROUTINE_OCCURRENCE_CONFLICT");
}
