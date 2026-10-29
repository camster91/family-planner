/** Native D1 adapter for detached future routine roots. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import {
  routineIndependentCatalog,
  routineIndependentCommand,
  routineIndependentReceipt,
  routineIndependentState,
  ROUTINE_INDEPENDENT_PROTOCOL,
  type RoutineIndependentCommand,
} from "@/lib/routine-independent";
import {
  independentRecoveryEntry,
  independentRecoveryReview,
  INDEPENDENT_RECOVERY_CONTRACT,
  type IndependentRecoveryEntry,
} from "@/lib/routine-independent-recovery";
import { ROUTINE_SCHEDULE_WRITE_ENV } from "@/lib/routine-schedule-gates";
import {
  normalizeRoutineSharedSchedule,
  routineStepSeriesConfig,
  routineViewerDay,
  type RoutineStepSeriesConfig,
} from "@/lib/routine-schedule";
import type { RoutineScheduleActor } from "@/lib/routine-schedule-runtime";
import { isProfileChoreEnabled, isProfileChoreRecurrenceSupported } from "@/lib/profile-chore-gates";
import { profileRoleSchema, isProfileAgeAllowed } from "@/lib/member-subject-contract";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

type Actor = RoutineScheduleActor;
type Root = { id: string; family_id: string; title: string; description: string | null; points: number; difficulty: string; icon: string | null; assigned_to: string | null; assigned_member_id: string | null; member_subject_erased: boolean; due_date: Date; recurrence_id: string | null; is_template: boolean; routine_stack_id: string | null; routine_anchor: string | null; routine_duration_minutes: number | null; routine_series_config: unknown };
type Occurrence = { id: string; due_date: Date; recurrence_id: string | null; routine_stack_id: string | null; status: string; photo_url: string | null; photo_verified: boolean; verified_at: Date | null; verified_notes: string | null; completed_at: Date | null; successor_id: string | null; is_template: boolean; member_subject_erased: boolean };
type Receipt = { id: string; family_id: string; user_id: string | null; action: string; request_hash: string; created_at: number; response_status: number | null; response_body: string | null; expires_at: number };
const fail = (status: number, code: string): EffectResult => ({ status, body: { error: { code } } });
const ROUTINE_INDEPENDENT_ACTION = "routine.independent.v1";
const parse = <T>(value: unknown): T | null => { if (value === null || value === undefined) return null; if (typeof value !== "string") return value as T; try { return JSON.parse(value) as T; } catch { return null; } };
const json = (value: unknown) => JSON.stringify(value);
const untouched = (row: Occurrence) => row.status === "pending" && !row.photo_url && !row.photo_verified && !row.verified_at && !row.verified_notes && !row.completed_at && !row.successor_id && !row.member_subject_erased && !row.is_template;

async function subjectAllowed(db: D1ReadClient, actor: Actor, subject: RoutineStepSeriesConfig["content"]["subject"], repeating: boolean) {
  if (subject.kind === "erased") return false;
  if (subject.kind === "account") {
    const account = await db.user.findFirst({ where: { id: subject.user_id, family_id: actor.familyId }, select: { id: true } });
    if (!account) return false;
    if (!subject.member_id) return true;
    const member = await db.householdMember.findFirst({ where: { id: subject.member_id, family_id: actor.familyId }, select: { id: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } });
    return Boolean(member && !member.archived_at && !member.erasure_user_id && (member.account_link?.user_id === subject.user_id || member.legacy_mapping?.user_id === subject.user_id));
  }
  if (actor.memberProtocol !== 2 || !isProfileChoreEnabled() || (repeating && !isProfileChoreRecurrenceSupported())) return false;
  const member = await db.householdMember.findFirst({ where: { id: subject.member_id, family_id: actor.familyId }, select: { id: true, role: true, age: true, archived_at: true, erasure_user_id: true, legacy_mapping: { select: { user_id: true } }, account_link: { select: { user_id: true } } } });
  if (!member || member.archived_at || member.erasure_user_id || member.legacy_mapping || member.account_link) return false;
  const role = profileRoleSchema.safeParse(member.role);
  return role.success && isProfileAgeAllowed(role.data, member.age);
}
async function readRoot(db: D1ReadClient, actor: Actor, rootId: string, includeRows = true) {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } });
  const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
  const features = parse<Record<string, unknown>>(family?.features) ?? {};
  if (!user || user.family_id !== actor.familyId || user.role !== "parent" || user.token_version !== actor.tokenVersion || !family || features.chores === false) return { denied: true as const, family, root: null, rows: [] };
  const root = await db.chore.findFirst({ where: { id: rootId, family_id: actor.familyId, recurrence_id: rootId }, select: { id: true, family_id: true, title: true, description: true, points: true, difficulty: true, icon: true, assigned_to: true, assigned_member_id: true, member_subject_erased: true, due_date: true, recurrence_id: true, is_template: true, routine_stack_id: true, routine_anchor: true, routine_duration_minutes: true, routine_series_config: true } });
  const rows = root && includeRows ? await db.chore.findMany({ where: { family_id: actor.familyId, recurrence_id: rootId }, select: { id: true, due_date: true, recurrence_id: true, routine_stack_id: true, status: true, photo_url: true, photo_verified: true, verified_at: true, verified_notes: true, completed_at: true, successor_id: true, is_template: true, member_subject_erased: true }, orderBy: [{ due_date: "asc" }, { id: "asc" }], take: 10001 }) : [];
  return { denied: false as const, family, root: root as Root | null, rows: rows as Occurrence[] };
}

function definition(row: Root) { const value = parse(row.routine_series_config); const result = routineStepSeriesConfig.safeParse(value); return result.success ? result.data : null; }
function receipt(value: string | null) { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }

export async function readD1IndependentRoutine(actor: Actor, rootId: string, database?: D1Store): Promise<EffectResult> {
  const store = database ?? await getD1Database();
  const capture = await captureD1Reads((db) => readRoot(db, actor, rootId), store as unknown as NativeD1);
  if (capture.value.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
  if (!capture.value.root) return fail(404, "ROUTINE_ROOT_UNAVAILABLE");
  const config = definition(capture.value.root);
  if (!config || config.stack_id !== null) return fail(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
  const pointsEnabled = Boolean((parse<Record<string, unknown>>(capture.value.family?.features) ?? {}).gamification);
  const { points, ...content } = config.content;
  return { status: 200, body: routineIndependentState.parse({ protocol: ROUTINE_INDEPENDENT_PROTOCOL, userId: actor.userId, familyId: actor.familyId, rootId, revision: config.revision, state: config.state, effectiveOn: config.effective_on, anchor: config.anchor, schedule: config.schedule, pointsEnabled, content: { ...content, subject: config.content.subject.kind === "erased" ? null : config.content.subject, ...(pointsEnabled ? { points } : {}) } }) };
}

export async function readD1IndependentCatalog(actor: Actor, cursor: string | null, database?: D1Store): Promise<EffectResult> {
  if (cursor !== null && (!cursor || cursor.length > 128)) return fail(400, "INVALID_QUERY");
  const store = database ?? await getD1Database();
  const capture = await captureD1Reads(async (db) => {
    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } });
    if (!user || user.family_id !== actor.familyId || user.role !== "parent" || user.token_version !== actor.tokenVersion) return null;
    const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
    if (!family || (parse<Record<string, unknown>>(family.features) ?? {}).chores === false) return null;
    const rows = await db.chore.findMany({ where: { family_id: actor.familyId, recurrence_id: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, title: true, routine_series_config: true }, orderBy: { id: "asc" }, take: 21 });
    return rows;
  }, store as unknown as NativeD1);
  if (!capture.value) return fail(403, "ROUTINE_PARENT_REQUIRED");
  const page = capture.value.slice(0, 20);
  return { status: 200, body: routineIndependentCatalog.parse({ protocol: ROUTINE_INDEPENDENT_PROTOCOL, userId: actor.userId, familyId: actor.familyId, steps: page.map((row) => { const config = routineStepSeriesConfig.safeParse(parse(row.routine_series_config)); const detached = config.success && config.data.stack_id === null; return { rootId: row.id, title: detached ? config.data.content.title : row.title, revision: detached ? config.data.revision : null, state: detached ? config.data.state : "unsupported", schedule: detached ? config.data.schedule : null }; }), nextCursor: capture.value.length > 20 ? page.at(-1)!.id : null }) };
}

/** Read-only exact-key review for a detached routine request. */
export async function reviewD1IndependentRoutine(
  actor: Actor,
  raw: IndependentRecoveryEntry,
  ownerScope: string,
  writesEnabled: boolean,
  now = new Date(),
  database?: D1Store,
): Promise<EffectResult> {
  const entry = independentRecoveryEntry.parse(raw);
  const input = routineIndependentCommand.parse(JSON.parse(entry.body));
  const store = database ?? (await getD1Database());
  const session = store.withSession("first-primary");
  const capture = await captureD1Reads(
    (db) => readRoot(db, actor, input.root_id, false),
    store as unknown as NativeD1,
  );
  if (capture.value.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
  if (
    input.expected_user_id !== actor.userId ||
    input.expected_family_id !== actor.familyId
  )
    return fail(403, "AUTH_CONTEXT_CHANGED");
  const requestHash = hashIdempotentRequest(ROUTINE_INDEPENDENT_ACTION, input);
  const record = await session
    .prepare(
      `SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at
       FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`,
    )
    .bind(`user:${actor.userId}`, entry.key)
    .first<Receipt>();
  if (
    record &&
    (record.family_id !== actor.familyId ||
      record.user_id !== actor.userId ||
      record.action !== ROUTINE_INDEPENDENT_ACTION ||
      record.request_hash !== requestHash)
  )
    return fail(422, "IDEMPOTENCY_KEY_REUSED");
  const current = capture.value.root ? definition(capture.value.root) : null;
  const reply = (
    state:
      | "ready"
      | "pending"
      | "committed"
      | "removed"
      | "expired"
      | "conflict"
      | "paused"
      | "unavailable",
    receipt: unknown = null,
  ): EffectResult => ({
    status: 200,
    body: independentRecoveryReview.parse({
      contract: INDEPENDENT_RECOVERY_CONTRACT,
      ownerScope,
      entry,
      state,
      canRetry: state === "ready" || state === "pending",
      currentRevision: current?.revision ?? null,
      receipt,
    }),
  });

  if (record?.response_status !== null && record?.response_status !== undefined) {
    const proof = routineIndependentReceipt.safeParse(receipt(record.response_body));
    if (
      record.response_status !== 200 ||
      !proof.success ||
      proof.data.requestId !== record.id ||
      proof.data.rootId !== input.root_id ||
      proof.data.action !== input.action ||
      proof.data.revision !== input.expected_revision + 1
    )
      return reply("unavailable");
    return reply(capture.value.root ? "committed" : "removed", proof.data);
  }

  const age = now.getTime() - Date.parse(input.issued_at);
  if (
    age < -60_000 ||
    age > 15 * 60_000 ||
    routineViewerDay(input.view_zone, now) !== input.view_day
  )
    return reply("expired");
  if (!current) return reply("unavailable");
  if (current.stack_id !== null) return reply("conflict");
  if (current.revision !== input.expected_revision) return reply("conflict");
  if (current.state === "stopped") return reply("conflict");
  if (
    (input.action === "pause" && current.state !== "active") ||
    (input.action === "resume" && current.state !== "paused") ||
    (input.action === "resume" &&
      current.schedule.frequency === "once" &&
      current.schedule.starts_on! <= input.view_day)
  )
    return reply("conflict");
  if (
    !writesEnabled ||
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] !== "1"
  )
    return reply("paused");
  return reply(record ? "pending" : "ready");
}

export async function saveD1IndependentRoutine(actor: Actor, raw: unknown, key: string, now = new Date(), database?: D1Store, writesEnabled = true): Promise<EffectResult> {
  const input = routineIndependentCommand.parse(raw), requestHash = hashIdempotentRequest("routine.independent.v1", input), store = database ?? await getD1Database(), session = store.withSession("first-primary");
  if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId) return fail(403, "AUTH_CONTEXT_CHANGED");
  // Re-authorize the live session and feature before inspecting a cached
  // response.  A completed receipt must never become a read-after-revocation
  // side channel (or survive a household chore-feature shutdown).
  const authority = await captureD1Reads((db) => readRoot(db, actor, input.root_id, false).then((value) => ({ denied: value.denied, root: value.root })), store as unknown as NativeD1);
  if (authority.value.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
  if (!authority.value.root) return fail(404, "ROUTINE_ROOT_UNAVAILABLE");
  const authorityConfig = definition(authority.value.root);
  if (!authorityConfig || authorityConfig.stack_id !== null) return fail(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
  const authorityChecks = authority.checks(session);
  let saved = await session.prepare(`SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, key).first<Receipt>();
  let expired = Boolean(saved && saved.expires_at <= now.getTime());
  if (saved && !expired && (saved.family_id !== actor.familyId || saved.user_id !== actor.userId || saved.action !== "routine.independent.v1" || saved.request_hash !== requestHash)) return fail(422, "IDEMPOTENCY_KEY_REUSED");
  if (saved && !expired && saved.response_status != null) {
    await session.batch(authorityChecks);
    const proof = routineIndependentReceipt.safeParse(receipt(saved.response_body));
    return proof.success ? { status: saved.response_status, body: proof.data } : fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
  }
  if (saved && !expired && saved.response_status === null && saved.created_at > now.getTime() - 30_000) return fail(409, "IDEMPOTENCY_IN_PROGRESS");
  if (!writesEnabled) return fail(409, "ROUTINE_WRITES_PAUSED");
  if (routineViewerDay(input.view_zone, now) !== input.view_day || now.getTime() - Date.parse(input.issued_at) > 15 * 60_000 || now.getTime() - Date.parse(input.issued_at) < -60_000) return fail(409, "ROUTINE_INTENT_EXPIRED");
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const capture = await captureD1Reads(async (db) => {
        const state = await readRoot(db, actor, input.root_id);
        let subjectValid = true;
        if (!state.denied && state.root && (input.action === "replace-future" || input.action === "resume")) {
          const prior = definition(state.root);
          const schedule = input.action === "replace-future" ? normalizeRoutineSharedSchedule(input.schedule, input.view_day) : prior?.schedule;
          const content = input.action === "replace-future" ? input.content : prior?.content;
          subjectValid = Boolean(schedule && content) && await subjectAllowed(db, actor, content!.subject, schedule!.frequency !== "once");
        }
        return { state, subjectValid };
      }, store as unknown as NativeD1), state = capture.value.state;
      if (state.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
      if (state.rows.length > 10000) return fail(409, "ROUTINE_REVIEW_TOO_LARGE");
      if (!capture.value.subjectValid) return fail(409, "ROUTINE_SUBJECT_UNAVAILABLE");
      if (!state.root) return fail(404, "ROUTINE_ROOT_UNAVAILABLE");
      const prior = definition(state.root);
      if (!prior || prior.stack_id !== null) return fail(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
      if (prior.revision !== input.expected_revision) return fail(409, "ROUTINE_VERSION_CONFLICT");
      if (prior.state === "stopped") return fail(409, "ROUTINE_STOPPED");
      if (input.action === "pause" && prior.state !== "active") return fail(409, "ROUTINE_STATE_CONFLICT");
      if (input.action === "resume" && prior.state !== "paused") return fail(409, "ROUTINE_STATE_CONFLICT");
      const schedule = input.action === "replace-future" ? normalizeRoutineSharedSchedule(input.schedule, input.view_day) : prior.schedule;
      if (input.action === "resume" && schedule.frequency === "once" && schedule.starts_on! <= input.view_day) return fail(409, "ROUTINE_ONCE_ALREADY_PASSED");
      const nextState = input.action === "pause" ? "paused" : input.action === "resume" ? "active" : input.action === "stop" ? "stopped" : prior.state;
      const effective = new Date(`${input.view_day}T00:00:00Z`); effective.setUTCDate(effective.getUTCDate() + 1);
      const next = routineStepSeriesConfig.parse({ ...prior, revision: prior.revision + 1, state: nextState, effective_on: effective.toISOString().slice(0, 10), anchor: input.action === "replace-future" ? input.anchor : prior.anchor, schedule, content: input.action === "replace-future" ? { ...input.content, points: input.content.points === null ? prior.content.points : input.content.points } : prior.content });
      const prune = state.rows.filter((row) => row.due_date.toISOString().slice(0, 10) > input.view_day && untouched(row)).map((row) => row.id);
      const requestId = expired || !saved ? randomUUID() : saved.id;
      const proof = routineIndependentReceipt.parse({ protocol: ROUTINE_INDEPENDENT_PROTOCOL, requestId, rootId: input.root_id, revision: next.revision, action: input.action, state: next.state, prunedCount: prune.length });
      const statements = [...capture.checks(session), d1WriteCheck(session, `EXISTS(SELECT 1 FROM "Family" WHERE id=?1 AND COALESCE(json_extract(features,'$.chores'),1)<>0)`, [actor.familyId]), d1WriteCheck(session, `EXISTS(SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND recurrence_id=id AND routine_series_config IS ?3 AND responsibility_epoch>=0)`, [state.root.id, actor.familyId, json(state.root.routine_series_config)])];
      if (saved && !expired) statements.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND response_status IS NULL AND created_at<=?2)`, [saved.id, now.getTime() - 30_000]));
      else {
        if (saved && expired) { statements.push(d1WriteCheck(session, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND expires_at<=?2)`, [saved.id, now.getTime()]), session.prepare(`DELETE FROM "IdempotencyRecord" WHERE id=?1`).bind(saved.id)); }
        saved = { id: requestId, family_id: actor.familyId, user_id: actor.userId, action: "routine.independent.v1", request_hash: requestHash, created_at: now.getTime(), response_status: null, response_body: null, expires_at: now.getTime() + IDEMPOTENCY_TTL_MS };
        statements.push(d1WriteCheck(session, `NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)`, [`user:${actor.userId}`, key]), session.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(requestId, `user:${actor.userId}`, key, actor.familyId, actor.userId, "routine.independent.v1", requestHash, now.getTime(), saved.expires_at)); }
      if (prune.length) statements.push(session.prepare(`DELETE FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2 AND id IN (SELECT value FROM json_each(?3)) AND status='pending' AND photo_url IS NULL AND photo_verified=0 AND verified_at IS NULL AND verified_notes IS NULL AND completed_at IS NULL AND successor_id IS NULL AND member_subject_erased=0 AND is_template=0`).bind(actor.familyId, input.root_id, json(prune)), d1WriteCheck(session, `changes()=?1`, [prune.length]));
      statements.push(session.prepare(`UPDATE "Chore" SET routine_series_config=?1,frequency=?2,weekly_days=?3,is_template=?4,routine_anchor=?5,routine_duration_minutes=?6 WHERE id=?7 AND family_id=?8 AND recurrence_id=id`).bind(json(next), next.schedule.frequency, json(next.schedule.weekly_days), next.schedule.frequency !== "once" && next.state !== "stopped" ? 1 : 0, next.anchor, next.content.duration_minutes, input.root_id, actor.familyId), d1WriteCheck(session, `changes()=1`, []), session.prepare(`UPDATE "IdempotencyRecord" SET response_status=200,response_body=?1 WHERE id=?2 AND response_status IS NULL`).bind(json(proof), requestId));
      await session.batch(statements);
      return { status: 200, body: proof };
    } catch (error) {
      if (isD1WriteConflict(error) || (error instanceof Error && /UNIQUE|constraint/i.test(error.message))) {
        saved = await session.prepare(`SELECT id,family_id,user_id,action,request_hash,created_at,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, key).first<Receipt>();
        expired = Boolean(saved && saved.expires_at <= now.getTime());
        if (saved && !expired && (saved.family_id !== actor.familyId || saved.user_id !== actor.userId || saved.action !== "routine.independent.v1" || saved.request_hash !== requestHash)) return fail(422, "IDEMPOTENCY_KEY_REUSED");
        if (saved && !expired && saved.response_status != null) {
          const live = await captureD1Reads((db) => readRoot(db, actor, input.root_id, false), store as unknown as NativeD1);
          if (live.value.denied) return fail(403, "ROUTINE_PARENT_REQUIRED");
          if (!live.value.root) return fail(409, "ROUTINE_ORIGINAL_REMOVED");
          await session.batch(live.checks(session));
          const proof = routineIndependentReceipt.safeParse(receipt(saved.response_body));
          return proof.success ? { status: saved.response_status, body: proof.data } : fail(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
        }
        continue;
      }
      throw error;
    }
  }
  return fail(409, "ROUTINE_OCCURRENCE_CONFLICT");
}
