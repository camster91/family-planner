/** Native D1 responsibility coordinator.
 *
 * Responsibility metadata is deliberately kept separate from chore/pickup
 * completion.  Every read re-resolves the target's generation/epoch and
 * every write carries those values as D1 preconditions, so a changed-away or
 * recreated target cannot accept an old consent or assignment.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { isProfileAgeAllowed, profileRoleSchema } from "@/lib/member-subject-contract";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import {
  ResponsibilityError,
  planResponsibility,
  projectResponsibility,
  responsibilityCommand,
  responsibilityState,
  type ResponsibilityCommand,
  type ResponsibilityContext,
  type ResponsibilityState,
  type ResponsibilitySubject,
  type ResponsibilityTarget,
} from "@/lib/responsibility";
import {
  RESPONSIBILITY_ACTION,
  responsibilityReceipt,
  responsibilityReceiptMatches,
  responsibilityView,
} from "@/lib/responsibility-http-contract";
import {
  RESPONSIBILITY_RECOVERY,
  responsibilityRecoveryReview,
  type ResponsibilityRecoveryEntry,
} from "@/lib/responsibility-recovery";
import { responsibilityWritingEnabled } from "@/lib/responsibility-owner";
import { responsibilitySourceToken, type ResponsibilitySourceEpoch } from "@/lib/responsibility-storage";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Statement, type D1Store } from "./database";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";
import { d1WriteCheck } from "./write-check";

export type D1ResponsibilityActor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};

type UserRow = { id: string; family_id: string | null; role: string; token_version: number; name: string };
type TargetRow = {
  id: string;
  title?: string;
  sitter_name?: string;
  status?: string;
  completed?: number | boolean;
  departure_time?: number | null;
  assigned_to?: string | null;
  assigned_member_id?: string | null;
  member_subject_erased?: number | boolean;
  recurrence_id?: string | null;
  responsibility_generation: string;
  responsibility_epoch: number;
};
type ProfileRow = {
  id: string;
  family_id: string;
  name: string;
  role: string;
  age: number | null;
  archived_at: number | null;
  erasure_user_id: string | null;
};

const text = (value: string | null | undefined) => Array.from((value ?? "").normalize("NFC")).slice(0, 200).join("");
const date = (value: unknown) => value == null ? null : new Date(typeof value === "number" ? value : String(value));
const bool = (value: unknown) => value === true || value === 1;
const targetSchema = z.object({ kind: z.enum(["chore", "pickup", "handoff"]), id: z.string().min(1).max(128) }).strict();

function failure(status: number, error: string): EffectResult { return { status, body: { error } }; }

async function store(database?: D1Store) { return database ?? await getD1Database(); }

async function storageAvailable(db: D1Store) {
  const row = await db.withSession("first-primary").prepare(`
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='ResponsibilityState')
      AND (SELECT COUNT(*) FROM pragma_table_info('Chore') WHERE name IN ('responsibility_generation','responsibility_epoch'))=2
      AND (SELECT COUNT(*) FROM pragma_table_info('Pickup') WHERE name IN ('responsibility_generation','responsibility_epoch'))=2
      AND (SELECT COUNT(*) FROM pragma_table_info('Handoff') WHERE name IN ('responsibility_generation','responsibility_epoch'))=2
    THEN 1 ELSE 0 END AS ready`).first<{ ready: number }>();
  return row?.ready === 1;
}

export async function d1ResponsibilityStorageAvailable(database?: D1Store) {
  return storageAvailable(await store(database));
}

async function authority(db: D1Store, actor: D1ResponsibilityActor) {
  const session = db.withSession("first-primary");
  const user = await session.prepare(`SELECT id,family_id,role,token_version,name FROM "User" WHERE id=?1`).bind(actor.userId).first<UserRow>();
  if (!user || user.token_version !== actor.tokenVersion || user.role !== actor.role) throw new ResponsibilityError("UNAUTHORIZED");
  if (user.family_id !== actor.familyId || !["parent", "teen", "child"].includes(user.role)) throw new ResponsibilityError("FORBIDDEN");
  const family = await session.prepare(`SELECT features FROM "Family" WHERE id=?1`).bind(actor.familyId).first<{ features: unknown }>();
  if (!family) throw new ResponsibilityError("FORBIDDEN");
  return { user, features: normalizeFeatures(typeof family.features === "string" ? (() => { try { return JSON.parse(family.features as string); } catch { return null; } })() : family.features) };
}

function targetFeature(target: ResponsibilityTarget) { return target.kind === "chore" ? "chores" : target.kind === "pickup" ? "pickups" : "handoff"; }

async function targetRow(db: D1Store, familyId: string, target: ResponsibilityTarget): Promise<TargetRow> {
  const session = db.withSession("first-primary");
  const query = target.kind === "chore"
    ? `SELECT id,title,status,assigned_to,assigned_member_id,member_subject_erased,recurrence_id,responsibility_generation,responsibility_epoch FROM "Chore" WHERE id=?1 AND family_id=?2`
    : target.kind === "pickup"
      ? `SELECT id,title,completed,assigned_to,responsibility_generation,responsibility_epoch FROM "Pickup" WHERE id=?1 AND family_id=?2`
      : `SELECT id,sitter_name,responsibility_generation,responsibility_epoch,departure_time FROM "Handoff" WHERE id=?1 AND family_id=?2`;
  const row = await session.prepare(query).bind(target.id, familyId).first<TargetRow>();
  if (!row) throw new ResponsibilityError("NOT_FOUND");
  if (!row.responsibility_generation || !Number.isInteger(row.responsibility_epoch)) throw new ResponsibilityError("UNAVAILABLE");
  return row;
}

async function source(db: D1Store, familyId: string, target: ResponsibilityTarget, row?: TargetRow) {
  const current = row ?? await targetRow(db, familyId, target);
  let source: ResponsibilitySourceEpoch = { generation: current.responsibility_generation, epoch: current.responsibility_epoch };
  if (target.kind === "chore" && current.recurrence_id) {
    const root = await db.withSession("first-primary").prepare(`SELECT id,recurrence_id,responsibility_generation,responsibility_epoch FROM "Chore" WHERE id=?1 AND family_id=?2`).bind(current.recurrence_id, familyId).first<{ id: string; recurrence_id: string | null; responsibility_generation: string; responsibility_epoch: number }>();
    if (!root || root.recurrence_id !== root.id) throw new ResponsibilityError("UNAVAILABLE");
    source = { ...source, recurrence_id: current.recurrence_id, root_generation: root.responsibility_generation, root_epoch: root.responsibility_epoch };
  }
  return { ...source, token: responsibilitySourceToken(target, familyId, source) };
}

async function stateRow(db: D1Store, familyId: string, target: ResponsibilityTarget) {
  const col = target.kind === "chore" ? "chore_id" : target.kind === "pickup" ? "pickup_id" : "handoff_id";
  const row = await db.withSession("first-primary").prepare(`SELECT id,protocol,family_id,chore_id,pickup_id,handoff_id,source_token,revision,coordinator_id,backup_account_id,backup_member_id,primary_subject_account_id,primary_subject_member_id,primary_decision,primary_by_id,primary_method,primary_at,backup_decision,backup_by_id,backup_method,backup_at FROM "ResponsibilityState" WHERE family_id=?1 AND ${col}=?2`).bind(familyId, target.id).first<Record<string, unknown>>();
  if (!row) return null;
  try {
    const refs = [row.chore_id, row.pickup_id, row.handoff_id].filter((value) => value !== null);
    if (refs.length !== 1) throw new Error("ambiguous target");
    const subject = (account: unknown, member: unknown): ResponsibilitySubject | null => {
      if (account && member) throw new Error("ambiguous subject");
      return account ? { kind: "account", accountId: String(account) } : member ? { kind: "profile", memberId: String(member) } : null;
    };
    const primary = subject(row.primary_subject_account_id, row.primary_subject_member_id);
    const backup = subject(row.backup_account_id, row.backup_member_id);
    const primaryAt = date(row.primary_at), backupAt = date(row.backup_at);
    const primaryParts = [primary, row.primary_decision, row.primary_by_id, row.primary_method, primaryAt];
    const backupParts = [row.backup_decision, row.backup_by_id, row.backup_method, backupAt];
    if ((primaryParts.some((value) => value !== null) && primaryParts.some((value) => value === null)) || (backupParts.some((value) => value !== null) && (!backup || backupParts.some((value) => value === null)))) throw new Error("partial statement");
    const state = responsibilityState.parse({
      protocol: row.protocol,
      familyId: row.family_id,
      target: { kind: row.chore_id ? "chore" : row.pickup_id ? "pickup" : "handoff", id: refs[0] },
      sourceToken: row.source_token,
      revision: row.revision,
      coordinator: row.coordinator_id ? { kind: "account", accountId: row.coordinator_id } : null,
      primaryStatement: primary ? { subject: primary, decision: row.primary_decision, byAccountId: row.primary_by_id, method: row.primary_method, at: primaryAt!.toISOString() } : null,
      backup: backup ? { subject: backup, statement: row.backup_decision === null ? null : { subject: backup, decision: row.backup_decision, byAccountId: row.backup_by_id, method: row.backup_method, at: backupAt!.toISOString() } } : null,
    });
    return { id: String(row.id), state };
  } catch {
    throw new ResponsibilityError("UNSUPPORTED");
  }
}

async function namesAndChoices(db: D1Store, actor: D1ResponsibilityActor, target: ResponsibilityTarget, query: string) {
  const session = db.withSession("first-primary");
  const like = query ? `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : "%";
  const roles = target.kind === "handoff" ? `('parent','teen')` : `('parent','teen','child')`;
  const users = actor.role === "parent" ? (await session.prepare(`SELECT id,name,role FROM "User" WHERE family_id=?1 AND role IN ${roles} AND name LIKE ?2 ESCAPE '\\' COLLATE NOCASE ORDER BY name ASC,id ASC LIMIT 51`).bind(actor.familyId, like).all<{ id: string; name: string; role: string }>()).results : [];
  const profiles = actor.role === "parent" && target.kind === "chore" && isProfileChoreEnabled() ? (await session.prepare(`SELECT m.id,m.family_id,m.name,m.role,m.age,m.archived_at,m.erasure_user_id FROM "HouseholdMember" m WHERE m.family_id=?1 AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND m.role IN ('parent','teen','child') AND m.name LIKE ?2 ESCAPE '\\' COLLATE NOCASE AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" l WHERE l.member_id=m.id AND l.family_id=m.family_id) AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" l WHERE l.member_id=m.id AND l.family_id=m.family_id) ORDER BY m.name ASC,m.id ASC LIMIT 51`).bind(actor.familyId, like).all<ProfileRow>()).results : [];
  const choices = [
    ...users.map((u) => ({ subject: { kind: "account" as const, accountId: u.id }, name: text(u.name) })),
    ...profiles.filter((p) => profileRoleSchema.safeParse(p.role).success && isProfileAgeAllowed(p.role as never, p.age)).map((p) => ({ subject: { kind: "profile" as const, memberId: p.id }, name: text(p.name) })),
  ].sort((a, b) => a.name.localeCompare(b.name) || JSON.stringify(a.subject).localeCompare(JSON.stringify(b.subject)));
  return { users, profiles, choices, moreChoices: users.length > 50 || profiles.length > 50 };
}

type Loaded = {
  target: ResponsibilityTarget;
  row: TargetRow;
  source: Awaited<ReturnType<typeof source>>;
  current: Awaited<ReturnType<typeof stateRow>>;
  context: ResponsibilityContext;
  title: string;
};

async function load(db: D1Store, actor: D1ResponsibilityActor, rawTarget: ResponsibilityTarget, query = "", now = new Date()): Promise<Loaded> {
  const target = targetSchema.parse(rawTarget) as ResponsibilityTarget;
  if (target.kind === "handoff" && actor.role === "child") throw new ResponsibilityError("FORBIDDEN");
  if (!(await storageAvailable(db))) throw new ResponsibilityError("UNAVAILABLE");
  const auth = await authority(db, actor);
  if (!isFeatureEnabled(auth.features, targetFeature(target) as never)) throw new ResponsibilityError("UNAVAILABLE");
  const row = await targetRow(db, actor.familyId, target);
  const sourceState = await source(db, actor.familyId, target, row);
  const current = await stateRow(db, actor.familyId, target);
  let primary: ResponsibilitySubject | null = null;
  let title = "";
  let active = false;
  if (target.kind === "chore") {
    title = text(row.title);
    if (row.assigned_to) primary = { kind: "account", accountId: row.assigned_to };
    else if (row.assigned_member_id && isProfileChoreEnabled() && !bool(row.member_subject_erased)) {
      const p = await db.withSession("first-primary").prepare(`SELECT id,role,age,archived_at,erasure_user_id FROM "HouseholdMember" WHERE id=?1 AND family_id=?2`).bind(row.assigned_member_id, actor.familyId).first<{ id: string; role: string; age: number | null; archived_at: number | null; erasure_user_id: string | null }>();
      if (p && p.archived_at == null && !p.erasure_user_id && profileRoleSchema.safeParse(p.role).success && isProfileAgeAllowed(p.role as never, p.age)) primary = { kind: "profile", memberId: p.id };
    }
    active = ["pending", "in_progress", "overdue"].includes(row.status ?? "") && !bool(row.member_subject_erased);
  } else if (target.kind === "pickup") {
    title = text(row.title); primary = row.assigned_to ? { kind: "account", accountId: row.assigned_to } : null; active = !bool(row.completed);
  } else {
    title = text(row.sitter_name); active = row.departure_time == null || Number(row.departure_time) >= now.getTime();
  }
  const named = await namesAndChoices(db, actor, target, query);
  const eligibleUsers = named.users.filter((u) => ["parent", "teen", "child"].includes(u.role) && (target.kind !== "handoff" || u.role !== "child"));
  const eligibleProfiles = named.profiles.filter((p) => profileRoleSchema.safeParse(p.role).success && isProfileAgeAllowed(p.role as never, p.age));
  const context: ResponsibilityContext = {
    actor: { kind: "person", userId: actor.userId, familyId: actor.familyId, role: actor.role },
    target: { ...target, familyId: actor.familyId, sourceToken: sourceState.token, active, primary },
    eligibleSubjects: [...eligibleUsers.map((u) => ({ kind: "account" as const, accountId: u.id })), ...eligibleProfiles.map((p) => ({ kind: "profile" as const, memberId: p.id }))],
    eligibleCoordinators: eligibleUsers.filter((u) => u.role !== "child").map((u) => ({ kind: "account" as const, accountId: u.id })),
    statementActorIds: eligibleUsers.map((u) => u.id),
    writesEnabled: responsibilityWritingEnabled(),
  };
  return { target, row, source: sourceState, current, context, title };
}

export async function readD1ResponsibilityView(actor: D1ResponsibilityActor, target: ResponsibilityTarget, query = "", database?: D1Store) {
  const db = await store(database);
  const loaded = await load(db, actor, target, query);
  const projection = projectResponsibility(loaded.current?.state ?? null, loaded.context);
  const names = new Map<string, string>();
  const all = await db.withSession("first-primary").prepare(`SELECT id,name FROM "User" WHERE family_id=?1`).bind(actor.familyId).all<{ id: string; name: string }>();
  all.results.forEach((u) => names.set(`account:${u.id}`, text(u.name)));
  const available = await namesAndChoices(db, actor, target, query);
  available.choices.forEach((choice) => names.set(choice.subject.kind === "account" ? `account:${choice.subject.accountId}` : `profile:${choice.subject.memberId}`, choice.name));
  const named = (subject: ResponsibilitySubject) => ({ subject, name: names.get(subject.kind === "account" ? `account:${subject.accountId}` : `profile:${subject.memberId}`) ?? "" });
  const statement = (value: ResponsibilityState["primaryStatement"]) => value ? { decision: value.decision, method: value.method, at: value.at, byAccountId: value.byAccountId, byName: names.get(`account:${value.byAccountId}`) ?? "" } : null;
  return responsibilityView.parse({ protocol: "herewoven.responsibility.v1", owner: { userId: actor.userId, familyId: actor.familyId }, target, title: loaded.title, href: target.kind === "chore" ? actor.role === "parent" ? "/dashboard/chores" : "/dashboard/today" : target.kind === "pickup" ? "/dashboard/pickups" : "/dashboard/handoff", sourceToken: loaded.source.token, revision: projection.stored.revision, active: loaded.context.target.active, writesEnabled: loaded.context.writesEnabled && loaded.context.target.active, role: actor.role, primary: projection.primary ? { member: named(projection.primary), statement: statement(projection.primaryStatement) } : null, backup: projection.backup ? { member: named(projection.backup.subject), statement: statement(projection.backup.statement) } : null, sourceChanged: projection.sourceChanged || projection.duplicateBackup, choices: available.choices.slice(0, 50), moreChoices: available.moreChoices });
}

function columns(state: ResponsibilityState) {
  const primary = state.primaryStatement, backup = state.backup;
  return {
    chore: state.target.kind === "chore" ? state.target.id : null,
    pickup: state.target.kind === "pickup" ? state.target.id : null,
    handoff: state.target.kind === "handoff" ? state.target.id : null,
    coordinator: state.coordinator?.accountId ?? null,
    backupAccount: backup?.subject.kind === "account" ? backup.subject.accountId : null,
    backupMember: backup?.subject.kind === "profile" ? backup.subject.memberId : null,
    primaryAccount: primary?.subject.kind === "account" ? primary.subject.accountId : null,
    primaryMember: primary?.subject.kind === "profile" ? primary.subject.memberId : null,
    primaryDecision: primary?.decision ?? null, primaryBy: primary?.byAccountId ?? null, primaryMethod: primary?.method ?? null, primaryAt: primary ? Date.parse(primary.at) : null,
    backupDecision: backup?.statement?.decision ?? null, backupBy: backup?.statement?.byAccountId ?? null, backupMethod: backup?.statement?.method ?? null, backupAt: backup?.statement ? Date.parse(backup.statement.at) : null,
  };
}

export function writeD1Responsibility(actor: D1ResponsibilityActor, command: ResponsibilityCommand, key: string, database?: D1Store, now = new Date()): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: { ...actor, generation: actor.tokenVersion }, action: RESPONSIBILITY_ACTION, input: command, key, database,
    authorize: async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      return user && user.family_id === actor.familyId && user.role === actor.role && user.token_version === actor.tokenVersion
        ? null
        : failure(401, "Unauthorized");
    },
    plan: async () => {
      const db = await store(database);
      const loaded = await load(db, actor, command.target, "", now);
      const planned = planResponsibility(loaded.current?.state ?? null, command, loaded.context, now);
      const c = columns(planned.state), expected = loaded.current?.state.revision ?? 0;
      const receipt = responsibilityReceipt.parse({ receipt: { protocol: "herewoven.responsibility.v1", userId: actor.userId, familyId: actor.familyId, target: command.target, requestKey: key, action: command.action, sourceToken: loaded.source.token, revision: planned.state.revision } });
      const sourceCheck = command.target.kind === "chore"
        ? `EXISTS (SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`
        : command.target.kind === "pickup"
          ? `EXISTS (SELECT 1 FROM "Pickup" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`
          : `EXISTS (SELECT 1 FROM "Handoff" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`;
      const sourceArgs = [command.target.id, actor.familyId, loaded.source.generation, loaded.source.epoch] as const;
      const effects = (session: Pick<D1Store, "prepare">): D1Statement[] => {
        const checks: D1Statement[] = [d1WriteCheck(session, sourceCheck, [...sourceArgs]), d1WriteCheck(session, `NOT EXISTS (SELECT 1 FROM "ResponsibilityState" WHERE family_id=?1 AND ${command.target.kind}_id=?2 AND revision<>?3)`, [actor.familyId, command.target.id, expected])];
        if (loaded.current) {
          checks.push(session.prepare(`UPDATE "ResponsibilityState" SET source_token=?1,revision=?2,coordinator_id=?3,backup_account_id=?4,backup_member_id=?5,primary_subject_account_id=?6,primary_subject_member_id=?7,primary_decision=?8,primary_by_id=?9,primary_method=?10,primary_at=?11,backup_decision=?12,backup_by_id=?13,backup_method=?14,backup_at=?15,updated_at=?16 WHERE id=?17 AND family_id=?18 AND revision=?19`).bind(loaded.source.token, planned.state.revision, c.coordinator, c.backupAccount, c.backupMember, c.primaryAccount, c.primaryMember, c.primaryDecision, c.primaryBy, c.primaryMethod, c.primaryAt, c.backupDecision, c.backupBy, c.backupMethod, c.backupAt, now.getTime(), loaded.current.id, actor.familyId, expected));
        } else {
          checks.push(session.prepare(`INSERT INTO "ResponsibilityState"(id,protocol,family_id,chore_id,pickup_id,handoff_id,source_token,revision,coordinator_id,backup_account_id,backup_member_id,primary_subject_account_id,primary_subject_member_id,primary_decision,primary_by_id,primary_method,primary_at,backup_decision,backup_by_id,backup_method,backup_at) VALUES (?1,'herewoven.responsibility.v1',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20) ON CONFLICT DO NOTHING`).bind(randomUUID(), actor.familyId, c.chore, c.pickup, c.handoff, loaded.source.token, planned.state.revision, c.coordinator, c.backupAccount, c.backupMember, c.primaryAccount, c.primaryMember, c.primaryDecision, c.primaryBy, c.primaryMethod, c.primaryAt, c.backupDecision, c.backupBy, c.backupMethod, c.backupAt));
        }
        checks.push(d1WriteCheck(session, "changes()=1"));
        return checks;
      };
      return { status: 200, body: receipt, effects };
    },
  });
}

export async function authorizeD1Responsibility(actor: D1ResponsibilityActor, database?: D1Store) { await authority(await store(database), actor); }

export async function reviewD1ResponsibilityRequest(actor: D1ResponsibilityActor, entry: ResponsibilityRecoveryEntry, ownerScope: string, database?: D1Store, now = new Date()) {
  const db = await store(database);
  const command = responsibilityCommand.parse(JSON.parse(entry.body));
  if (command.userId !== actor.userId || command.familyId !== actor.familyId) throw new ResponsibilityError("FORBIDDEN");
  await authority(db, actor);
  const record = await db.withSession("first-primary").prepare(`SELECT family_id,user_id,action,request_hash,response_status,response_body FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, entry.key).first<{ family_id: string; user_id: string | null; action: string; request_hash: string; response_status: number | null; response_body: unknown }>();
  if (record && (record.family_id !== actor.familyId || record.user_id !== actor.userId || record.action !== RESPONSIBILITY_ACTION || record.request_hash !== hashIdempotentRequest(RESPONSIBILITY_ACTION, command))) throw new ResponsibilityError("CONFLICT");
  const loaded = await load(db, actor, command.target, "", now);
  const reply = (state: "ready" | "pending" | "committed" | "expired" | "conflict" | "paused" | "unavailable", receipt: unknown = null) => responsibilityRecoveryReview.parse({ contract: RESPONSIBILITY_RECOVERY, ownerScope, entry, state, canRetry: state === "ready" || state === "pending", currentRevision: loaded.current?.state.revision ?? 0, receipt });
  if (record?.response_status != null) {
    let body: unknown = record.response_body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    return record.response_status === 200 && responsibilityReceiptMatches(body, command, entry.key) ? reply("committed", responsibilityReceipt.parse(body)) : reply("unavailable");
  }
  const age = now.getTime() - Date.parse(command.issuedAt);
  if (age > 15 * 60000 || age < -60000) return reply("expired");
  if (command.expectedRevision !== (loaded.current?.state.revision ?? 0) || command.sourceToken !== loaded.source.token) return reply("conflict");
  try { planResponsibility(loaded.current?.state ?? null, command, loaded.context, now); } catch (error) { if (error instanceof ResponsibilityError && error.code === "UNAVAILABLE" && !loaded.context.writesEnabled) return reply("paused"); return reply("conflict"); }
  return loaded.context.writesEnabled ? reply(record ? "pending" : "ready") : reply("paused");
}
