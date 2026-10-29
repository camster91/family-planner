/** Native D1 readers and writes for pinned notes and family projects.
 *
 * The HTTP contracts for these older domains are intentionally kept here
 * rather than making the route handlers call themselves.  Every operation
 * re-checks the current user, household, token generation and feature flag;
 * cursor/record ids are never treated as authority.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { AssistantSourceGuard } from "@/lib/assistant-source-proof";
import type { D1ReadClient } from "./read-client";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { encodeNoteCursor, type NotePaging } from "@/lib/note-paging";
import { encodeProjectCursor, type ProjectPaging } from "@/lib/project-paging";
import { encodeProjectTaskCursor, type ProjectTaskPaging } from "@/lib/project-task-paging";
import { allDayRange, projectTaskUid } from "@/lib/project-calendar";
import { DEFAULT_FAMILY_TIMEZONE } from "@/lib/calendar-import/timezone";

export type D1NotesProjectsActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type NativeResult = EffectResult & { replayed?: boolean };
type Authority = { family_id: string | null; role: string; token_version: number; features: string | null };

const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple"] as const;
const PROJECT_ROLES = ["parent", "teen", "child"];
const failure = (status: number, error: string, code?: string): EffectResult => ({
  status,
  body: code ? { error: { code, message: error } } : { error },
});

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function familyFeatures(value: unknown) {
  return normalizeFeatures(json(value));
}

function noteDto(row: any) {
  return {
    ...row,
    pinned: Number(row.pinned) === 1,
    created_at: new Date(Number(row.created_at)),
    updated_at: new Date(Number(row.updated_at)),
  };
}

function person(row: any) {
  return row ? { id: row.id, name: row.name, avatar_url: row.avatar_url ?? null } : null;
}

function projectDto(row: any, creator?: any) {
  return {
    id: row.id,
    family_id: row.family_id,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    color: row.color,
    created_by: row.created_by,
    created_at: new Date(Number(row.created_at)),
    updated_at: new Date(Number(row.updated_at)),
    ...(creator === undefined ? {} : { creator: person(creator) }),
  };
}

function taskDto(row: any, assignee?: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description ?? null,
    completed: Number(row.completed) === 1,
    assigned_to: row.assigned_to ?? null,
    due_date: row.due_date == null ? null : new Date(Number(row.due_date)),
    position: Number(row.position),
    created_at: new Date(Number(row.created_at)),
    updated_at: new Date(Number(row.updated_at)),
    ...(assignee === undefined ? {} : { assignee: person(assignee) }),
  };
}

function actorWriteCheck(db: Pick<D1Store, "prepare">, actor: D1NotesProjectsActor) {
  return d1WriteCheck(db,
    `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`,
    [actor.userId, actor.familyId, actor.role, actor.generation]);
}

async function currentActorRefusal(db: Pick<D1Store, "prepare">, actor: D1NotesProjectsActor): Promise<EffectResult | null> {
  const row = await db.prepare(`SELECT family_id,role,token_version FROM "User" WHERE id=?1`).bind(actor.userId).first<Authority>();
  if (!row || row.family_id !== actor.familyId || row.role !== actor.role || row.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  return null;
}

async function authority(db: Pick<D1Store, "prepare">, actor: D1NotesProjectsActor, feature: "notes" | "projects") {
  const row = await db.prepare(`SELECT u.family_id,u.role,u.token_version,f.features
    FROM "User" u LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1`).bind(actor.userId, actor.familyId).first<Authority>();
  if (!row || row.family_id !== actor.familyId || row.role !== actor.role || row.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (!PROJECT_ROLES.includes(row.role)) return failure(403, "This account cannot access this household");
  if (!isFeatureEnabled(familyFeatures(row.features), feature)) return failure(403, "This feature is turned off for your family");
  return null;
}

async function readAuthority(db: D1ReadClient, actor: D1NotesProjectsActor, feature: "notes" | "projects") {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (!PROJECT_ROLES.includes(user.role)) return failure(403, "This account cannot access this household");
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), feature)) return failure(403, "This feature is turned off for your family");
  return null;
}

async function withReadAuthority<T>(actor: D1NotesProjectsActor, feature: "notes" | "projects", read: (db: D1Store) => Promise<T>, database?: D1Store): Promise<{ denied: EffectResult | null; value?: T }> {
  const store = database ?? await getD1Database();
  const denied = await authority(store.withSession("first-primary") as D1Store, actor, feature);
  if (denied) return { denied };
  return { denied: null, value: await read(store.withSession("first-primary") as D1Store) };
}

export async function readD1Notes(actor: D1NotesProjectsActor, paging: NotePaging, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const denied = await authority(db, actor, "notes");
  if (denied) return denied;
  const values: SqlValue[] = [actor.familyId];
  let where = `family_id=?1`;
  if (paging.ok && paging.paged && paging.cursor) {
    values.push(paging.cursor.createdAt.getTime(), paging.cursor.id);
    where += ` AND (created_at<?2 OR (created_at=?2 AND id>?3))`;
  }
  const limit = paging.ok && paging.paged ? paging.limit + 1 : 10000;
  const rows = await db.prepare(`SELECT id,family_id,title,body,color,pinned,created_by,created_at,updated_at
    FROM "PinnedNote" WHERE ${where} ORDER BY created_at DESC,id ASC LIMIT ${limit}`).bind(...values).all<any>();
  const notes = rows.results.slice(0, paging.ok && paging.paged ? paging.limit : undefined).map(noteDto);
  const body: Record<string, unknown> = {
    writeContext: { userId: actor.userId, familyId: actor.familyId },
    notes: notes.map((note: any) => ({ ...note, can_edit: actor.role === "parent" || note.created_by === actor.userId, can_delete: actor.role === "parent" })),
  };
  if (paging.ok && paging.paged) {
    body.nextCursor = rows.results.length > paging.limit && notes.length
      ? encodeNoteCursor(actor.familyId, notes[notes.length - 1]) : null;
  }
  return { status: 200, body };
}

function noteInput(input: any) {
  return {
    title: input.title,
    body: (input.body || "").trim(),
    color: typeof input.color === "string" && (NOTE_COLORS as readonly string[]).includes(input.color) ? input.color : "yellow",
  };
}

export function createD1Note(actor: D1NotesProjectsActor, input: any, key: string | null, sourceGuard?: AssistantSourceGuard, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "note.create", input, key, database,
    authorize: db => readAuthority(db, actor, "notes"), sourceGuard,
    plan: async (_db, _recordId) => {
      if (input.expected_user_id !== undefined && (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId))
        return failure(409, "NOTE_OWNER_CHANGED");
      const value = noteInput(input), now = new Date(), id = randomUUID();
      const note = { id, family_id: actor.familyId, title: value.title, body: value.body, color: value.color, pinned: true, created_by: actor.userId, created_at: now, updated_at: now };
      return {
        status: 201, body: { note },
        effects: session => [session.prepare(`INSERT INTO "PinnedNote" (id,family_id,title,body,color,pinned,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,1,?6,?7,?7)`).bind(id, actor.familyId, value.title, value.body, value.color, actor.userId, now.getTime())],
      };
    },
  });
}

export async function updateD1Note(actor: D1NotesProjectsActor, input: any, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await authority(db, actor, "notes"); if (denied) return denied;
  const note = await db.prepare(`SELECT id,family_id,title,body,color,created_by,created_at,updated_at FROM "PinnedNote" WHERE id=?1 AND family_id=?2`).bind(input.id, actor.familyId).first<any>();
  if (!note) return failure(404, "Note not found");
  if (actor.role !== "parent" && note.created_by !== actor.userId) return failure(403, "You can only edit notes you created");
  if (input.expected_updated_at !== undefined && Date.parse(input.expected_updated_at) !== Number(note.updated_at))
    return { status: 409, body: { error: { code: "NOTE_CHANGED", message: "This note changed. Review the saved version before saving.", retryable: false }, current: { ...noteDto(note), created_by: undefined } } };
  const now = new Date(Math.max(Date.now(), Number(note.updated_at) + 1)), value = noteInput({ ...note, ...input });
  const statements = [
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`, [actor.userId, actor.familyId, actor.role, actor.generation]),
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "PinnedNote" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [input.id, actor.familyId, Number(note.updated_at)]),
    db.prepare(`UPDATE "PinnedNote" SET title=?3,body=?4,color=?5,updated_at=?6 WHERE id=?1 AND family_id=?2 AND updated_at=?7`).bind(input.id, actor.familyId, input.title ?? note.title, input.body === undefined ? note.body : value.body, input.color === undefined ? note.color : value.color, now.getTime(), Number(note.updated_at)),
    d1WriteCheck(db, "changes()=1"),
  ];
  try { await db.batch(statements); } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await db.prepare(`SELECT id,family_id,title,body,color,pinned,created_by,created_at,updated_at FROM "PinnedNote" WHERE id=?1 AND family_id=?2`).bind(input.id, actor.familyId).first<any>();
    const refused = await currentActorRefusal(db, actor);
    if (refused) return refused;
    if (!current) return failure(404, "Note not found");
    return { status: 409, body: { error: { code: "NOTE_CHANGED", message: "This note changed. Review the saved version before saving.", retryable: false }, current: { ...noteDto(current), created_by: undefined } } };
  }
  const updated = await db.prepare(`SELECT id,family_id,title,body,color,pinned,created_by,created_at,updated_at FROM "PinnedNote" WHERE id=?1 AND family_id=?2`).bind(input.id, actor.familyId).first<any>();
  return { status: 200, body: { note: noteDto(updated) } };
}

export async function deleteD1Note(actor: D1NotesProjectsActor, id: string, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await authority(db, actor, "notes"); if (denied) return denied;
  if (actor.role !== "parent") return failure(403, "Only parents can delete notes");
  const statements = [actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "PinnedNote" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]), db.prepare(`DELETE FROM "PinnedNote" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId), d1WriteCheck(db, "changes()=1")];
  try { await db.batch(statements); } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const refused = await currentActorRefusal(db, actor);
    if (refused) return refused;
    return failure(404, "Note not found");
  }
  return { status: 200, body: { success: true } };
}

export async function inspectD1NoteReceipt(actor: D1NotesProjectsActor, key: string, input: any, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await authority(db, actor, "notes"); if (denied) return denied;
  if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId) return { status: 409, body: { error: { code: "NOTE_OWNER_CHANGED", retryable: false } } };
  const row = await db.prepare(`SELECT action,request_hash,response_status,response_body,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2 AND family_id=?3 AND user_id=?4`).bind(`user:${actor.userId}`, key, actor.familyId, actor.userId).first<any>();
  if (!row) return { status: 200, body: { state: "unissued" } };
  if (row.action !== "note.create" || row.request_hash !== hashIdempotentRequest("note.create", input)) return { status: 422, body: { error: { code: "IDEMPOTENCY_KEY_REUSED", retryable: false } } };
  if (Number(row.expires_at) <= Date.now()) return { status: 200, body: { state: "expired" } };
  if (row.response_status === null) return { status: 200, body: { state: "pending" } };
  let body: any; try { body = JSON.parse(row.response_body); } catch { return { status: 200, body: { state: "unavailable" } }; }
  const noteId = body?.note?.id;
  if (typeof noteId !== "string" || body.note.family_id !== actor.familyId || body.note.created_by !== actor.userId) return { status: 200, body: { state: "unavailable" } };
  const current = await db.prepare(`SELECT id FROM "PinnedNote" WHERE id=?1 AND family_id=?2`).bind(noteId, actor.familyId).first();
  return { status: 200, body: { state: current ? "present" : "removed", noteId } };
}

export async function readD1NoteRecovery(
  actor: D1NotesProjectsActor,
  recovery: { enabled: boolean; owner: unknown },
  database?: D1Store,
) {
  const store = database ?? await getD1Database();
  const denied = await authority(store.withSession("first-primary"), actor, "notes");
  if (denied) return denied;
  return {
    status: 200,
    body: {
      contract: "herewoven.note-create-recovery.v1",
      enabled: recovery.enabled,
      owner: recovery.owner,
      userId: actor.userId,
      familyId: actor.familyId,
    },
  };
}

export async function readD1Projects(actor: D1NotesProjectsActor, scope: { status: string | null }, paging: ProjectPaging, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary");
  const denied = await authority(db, actor, "projects"); if (denied) return denied;
  const values: SqlValue[] = [actor.familyId], where = scope.status ? `family_id=?1 AND status=?2` : `family_id=?1`;
  if (scope.status) values.push(scope.status);
  if (paging.ok && paging.paged && paging.cursor) { values.push(paging.cursor.createdAt.getTime(), paging.cursor.id); }
  const cursor = paging.ok && paging.paged && paging.cursor ? ` AND (created_at<?${values.length - 1} OR (created_at=?${values.length - 1} AND id>?${values.length}))` : "";
  const limit = paging.ok && paging.paged ? paging.limit + 1 : 10000;
  const rows = await db.prepare(`SELECT id,family_id,name,description,status,color,created_by,created_at,updated_at FROM "Project" WHERE ${where}${cursor} ORDER BY created_at DESC,id ASC LIMIT ${limit}`).bind(...values).all<any>();
  const page = rows.results.slice(0, paging.ok && paging.paged ? paging.limit : undefined);
  const ids = page.map(row => row.id);
  const creators = ids.length ? await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE family_id=?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`).bind(actor.familyId, ...ids).all<any>() : { results: [] as any[] };
  const creatorMap = new Map(creators.results.map(row => [row.id, row]));
  const counts = ids.length ? await db.prepare(`SELECT project_id,completed,COUNT(*) AS total FROM "ProjectTask" WHERE project_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")}) GROUP BY project_id,completed`).bind(actor.familyId, ...ids).all<any>() : { results: [] as any[] };
  const countMap = new Map<string, { total: number; completed: number }>();
  for (const row of counts.results) { const count = countMap.get(row.project_id) ?? { total: 0, completed: 0 }; count.total += Number(row.total); if (Number(row.completed)) count.completed += Number(row.total); countMap.set(row.project_id, count); }
  const projects = page.map(row => ({ ...projectDto(row, creatorMap.get(row.created_by)), taskCount: countMap.get(row.id)?.total ?? 0, completedTaskCount: countMap.get(row.id)?.completed ?? 0 }));
  const body: any = { projects };
  if (paging.ok && paging.paged) body.nextCursor = rows.results.length > paging.limit && page.length ? encodeProjectCursor({ familyId: actor.familyId, status: scope.status }, page[page.length - 1]) : null;
  return { status: 200, body };
}

async function projectById(db: Pick<D1Store, "prepare">, actor: D1NotesProjectsActor, id: string) {
  return db.prepare(`SELECT id,family_id,name,description,status,color,created_by,created_at,updated_at FROM "Project" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<any>();
}

export async function readD1Project(actor: D1NotesProjectsActor, id: string, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary"); const denied = await authority(db, actor, "projects"); if (denied) return denied;
  const row = await projectById(db, actor, id); if (!row) return failure(404, "Project not found");
  const creator = await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE id=?1 AND family_id=?2`).bind(row.created_by, actor.familyId).first<any>();
  const tasks = await db.prepare(`SELECT t.*,u.id AS assignee_id,u.name AS assignee_name,u.avatar_url AS assignee_avatar_url FROM "ProjectTask" t LEFT JOIN "User" u ON u.id=t.assigned_to AND u.family_id=?2 WHERE t.project_id=?1 ORDER BY t.position ASC`).bind(id, actor.familyId).all<any>();
  const totalTasks = tasks.results.length, completedTaskCount = tasks.results.filter(row => Number(row.completed) === 1).length;
  return { status: 200, body: { project: { ...projectDto(row, creator), tasks: tasks.results.map(t => taskDto(t, t.assignee_id ? { id: t.assignee_id, name: t.assignee_name, avatar_url: t.assignee_avatar_url } : null)), taskCount: totalTasks, completedTaskCount, progress: totalTasks ? Math.round(completedTaskCount / totalTasks * 100) : 0 } } };
}

export async function readD1ProjectTasks(actor: D1NotesProjectsActor, projectId: string, filterCompleted: boolean | null, paging: ProjectTaskPaging, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary"); const denied = await authority(db, actor, "projects"); if (denied) return denied;
  if (!(await projectById(db, actor, projectId))) return failure(404, "Project not found");
  const values: SqlValue[] = [projectId, actor.familyId]; let where = `t.project_id=?1 AND p.family_id=?2`;
  if (filterCompleted !== null) { values.push(filterCompleted ? 1 : 0); where += ` AND t.completed=?${values.length}`; }
  if (paging.ok && paging.paged && paging.cursor) { values.push(paging.cursor.position, paging.cursor.createdAt.getTime(), paging.cursor.id); where += ` AND (t.position>?${values.length - 2} OR (t.position=?${values.length - 2} AND t.created_at>?${values.length - 1}) OR (t.position=?${values.length - 2} AND t.created_at=?${values.length - 1} AND t.id>?${values.length}))`; }
  const limit = paging.ok && paging.paged ? paging.limit + 1 : 10000;
  const rows = await db.prepare(`SELECT t.*,u.id AS assignee_id,u.name AS assignee_name,u.avatar_url AS assignee_avatar_url FROM "ProjectTask" t JOIN "Project" p ON p.id=t.project_id LEFT JOIN "User" u ON u.id=t.assigned_to AND u.family_id=?2 WHERE ${where} ORDER BY t.position ASC,t.created_at ASC,t.id ASC LIMIT ${limit}`).bind(...values).all<any>();
  const page = rows.results.slice(0, paging.ok && paging.paged ? paging.limit : undefined); const body: any = { tasks: page.map(row => taskDto(row, row.assignee_id ? { id: row.assignee_id, name: row.assignee_name, avatar_url: row.assignee_avatar_url } : null)) };
  if (paging.ok && paging.paged) body.nextCursor = rows.results.length > paging.limit && page.length ? encodeProjectTaskCursor({ familyId: actor.familyId, projectId, completed: filterCompleted }, page[page.length - 1]) : null;
  return { status: 200, body };
}

export function createD1Project(actor: D1NotesProjectsActor, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({ actor, action: "projects.create", input, key, database, authorize: db => readAuthority(db, actor, "projects"), plan: async (db) => {
    const now = new Date(), id = randomUUID(), creator = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true, avatar_url: true } });
    const project = { id, family_id: actor.familyId, name: input.name, description: input.description || null, status: input.status || "active", color: input.color || "#3B82F6", created_by: actor.userId, created_at: now, updated_at: now, creator, _count: { tasks: 0 } };
    return { status: 201, body: { project }, effects: session => [session.prepare(`INSERT INTO "Project" (id,family_id,name,description,status,color,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)`).bind(id, actor.familyId, project.name, project.description, project.status, project.color, actor.userId, now.getTime())] };
  } });
}

export function createD1ProjectTask(actor: D1NotesProjectsActor, projectId: string, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({ actor, action: `projects.task.create:${projectId}`, input, key, database, authorize: db => readAuthority(db, actor, "projects"), plan: async (db) => {
    const project = await db.project.findFirst({ where: { id: projectId, family_id: actor.familyId }, select: { id: true, status: true } });
    if (!project) return failure(404, "Project not found"); if (project.status !== "active") return failure(400, "Cannot add tasks to a completed or archived project");
    let assignee: any = null; if (input.assigned_to) { assignee = await db.user.findFirst({ where: { id: input.assigned_to, family_id: actor.familyId }, select: { id: true, name: true, avatar_url: true } }); if (!assignee) return failure(404, "Assigned user not found"); }
    const aggregate = await db.projectTask.aggregate({ where: { project_id: projectId }, _max: { position: true } }); const now = new Date(), id = randomUUID(), due = input.due_date ? new Date(input.due_date) : null, position = (aggregate._max.position ?? -1) + 1;
    const task = { id, project_id: projectId, title: input.title, description: input.description || null, completed: false, assigned_to: input.assigned_to || null, due_date: due, position, created_at: now, updated_at: now, assignee };
    return { status: 201, body: { task }, effects: session => [session.prepare(`INSERT INTO "ProjectTask" (id,project_id,title,description,completed,assigned_to,due_date,position,created_at,updated_at) VALUES (?1,?2,?3,?4,0,?5,?6,?7,?8,?8)`).bind(id, projectId, task.title, task.description, task.assigned_to, due?.getTime() ?? null, position, now.getTime()), session.prepare(`UPDATE "Project" SET updated_at=?2 WHERE id=?1 AND family_id=?3`).bind(projectId, now.getTime(), actor.familyId)] };
  }, });
}

export async function updateD1Project(actor: D1NotesProjectsActor, id: string, input: any, database?: D1Store): Promise<NativeResult> { return updateProjectLike(actor, id, input, false, database); }
export async function deleteD1Project(actor: D1NotesProjectsActor, id: string, database?: D1Store): Promise<NativeResult> { return updateProjectLike(actor, id, null, true, database); }
async function updateProjectLike(actor: D1NotesProjectsActor, id: string, input: any, remove: boolean, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary"); const denied = await authority(db, actor, "projects"); if (denied) return denied; if (actor.role !== "parent") return failure(403, "Forbidden");
  const row = await projectById(db, actor, id); if (!row) return failure(404, "Project not found");
  if (remove) {
    try { await db.batch([actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Project" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]), db.prepare(`DELETE FROM "Project" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId), d1WriteCheck(db, "changes()=1")]); }
    catch (error) {
      if (!isD1WriteConflict(error)) throw error;
      const refused = await currentActorRefusal(db, actor); if (refused) return refused;
      return failure(404, "Project not found");
    }
    return { status: 200, body: { success: true } };
  }
  const next = { name: input.name ?? row.name, description: input.description === undefined ? row.description : input.description, color: input.color ?? row.color, status: input.status ?? row.status }, now = new Date(Math.max(Date.now(), Number(row.updated_at) + 1));
  try { await db.batch([actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Project" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [id, actor.familyId, Number(row.updated_at)]), db.prepare(`UPDATE "Project" SET name=?3,description=?4,color=?5,status=?6,updated_at=?7 WHERE id=?1 AND family_id=?2 AND updated_at=?8`).bind(id, actor.familyId, next.name, next.description, next.color, next.status, now.getTime(), Number(row.updated_at)), d1WriteCheck(db, "changes()=1")]); }
  catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const refused = await currentActorRefusal(db, actor); if (refused) return refused;
    const current = await projectById(db, actor, id); if (!current) return failure(404, "Project not found");
    return { status: 409, body: { error: { code: "PROJECT_CHANGED", message: "This project changed. Refresh before saving.", retryable: false } } };
  }
  const updated = await projectById(db, actor, id), creator = await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE id=?1 AND family_id=?2`).bind(row.created_by, actor.familyId).first<any>(); return { status: 200, body: { project: { ...projectDto(updated, creator), _count: { tasks: 0 } } } };
}

export async function updateD1ProjectTask(actor: D1NotesProjectsActor, projectId: string, taskId: string, input: any, database?: D1Store): Promise<NativeResult> { return mutateTask(actor, projectId, taskId, input, false, database); }
export async function deleteD1ProjectTask(actor: D1NotesProjectsActor, projectId: string, taskId: string, database?: D1Store): Promise<NativeResult> { return mutateTask(actor, projectId, taskId, null, true, database); }
async function mutateTask(actor: D1NotesProjectsActor, projectId: string, taskId: string, input: any, remove: boolean, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary"); const denied = await authority(db, actor, "projects"); if (denied) return denied; if (actor.role !== "parent") return failure(403, "Forbidden");
  const row = await db.prepare(`SELECT t.*,p.family_id FROM "ProjectTask" t JOIN "Project" p ON p.id=t.project_id WHERE t.id=?1 AND t.project_id=?2 AND p.family_id=?3`).bind(taskId, projectId, actor.familyId).first<any>();
  if (!row) return failure(404, "Task not found");
  if (remove) {
    try { await db.batch([actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "ProjectTask" t JOIN "Project" p ON p.id=t.project_id WHERE t.id=?1 AND t.project_id=?2 AND p.family_id=?3)`, [taskId, projectId, actor.familyId]), db.prepare(`DELETE FROM "ProjectTask" WHERE id=?1 AND project_id=?2`).bind(taskId, projectId), d1WriteCheck(db, "changes()=1"), db.prepare(`UPDATE "Project" SET updated_at=?2 WHERE id=?1 AND family_id=?3`).bind(projectId, Date.now(), actor.familyId)]); }
    catch (error) {
      if (!isD1WriteConflict(error)) throw error;
      const refused = await currentActorRefusal(db, actor); if (refused) return refused;
      return failure(404, "Task not found");
    }
    return { status: 200, body: { success: true } };
  }
  let assignee: any = row.assigned_to ? await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE id=?1 AND family_id=?2`).bind(row.assigned_to, actor.familyId).first<any>() : null;
  if (input.assigned_to !== undefined && input.assigned_to !== null) { assignee = await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE id=?1 AND family_id=?2`).bind(input.assigned_to, actor.familyId).first<any>(); if (!assignee) return failure(404, "Assigned user not found"); }
  if (input.assigned_to === null) assignee = null;
  const next = { title: input.title ?? row.title, description: input.description === undefined ? row.description : input.description, completed: input.completed === undefined ? Number(row.completed) : input.completed ? 1 : 0, assigned_to: input.assigned_to === undefined ? row.assigned_to : input.assigned_to, due_date: input.due_date === undefined ? row.due_date : input.due_date ? new Date(input.due_date).getTime() : null, position: input.position ?? row.position }, now = Date.now();
  try { await db.batch([actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "ProjectTask" WHERE id=?1 AND project_id=?2 AND updated_at=?3)`, [taskId, projectId, Number(row.updated_at)]), db.prepare(`UPDATE "ProjectTask" SET title=?3,description=?4,completed=?5,assigned_to=?6,due_date=?7,position=?8,updated_at=?9 WHERE id=?1 AND project_id=?2 AND updated_at=?10`).bind(taskId, projectId, next.title, next.description, next.completed, next.assigned_to, next.due_date, next.position, now, Number(row.updated_at)), d1WriteCheck(db, "changes()=1"), db.prepare(`UPDATE "Project" SET updated_at=?2 WHERE id=?1 AND family_id=?3`).bind(projectId, now, actor.familyId)]); }
  catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const refused = await currentActorRefusal(db, actor); if (refused) return refused;
    const current = await db.prepare(`SELECT id FROM "ProjectTask" WHERE id=?1 AND project_id=?2`).bind(taskId, projectId).first();
    if (!current) return failure(404, "Task not found");
    return { status: 409, body: { error: { code: "TASK_CHANGED", message: "This task changed. Refresh before saving.", retryable: false } } };
  }
  const updated = await db.prepare(`SELECT * FROM "ProjectTask" WHERE id=?1 AND project_id=?2`).bind(taskId, projectId).first<any>(); return { status: 200, body: { task: taskDto(updated, assignee) } };
}

export async function sendD1ProjectToCalendar(actor: D1NotesProjectsActor, projectId: string, timeZone = DEFAULT_FAMILY_TIMEZONE, summary = false, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database(), db = store.withSession("first-primary"); const denied = await authority(db, actor, "projects"); if (denied) return denied;
  const project = await projectById(db, actor, projectId); if (!project) return failure(404, "Project not found");
  const tasks = await db.prepare(`SELECT t.id,t.title,t.description,t.due_date FROM "ProjectTask" t WHERE t.project_id=?1 AND t.completed=0 AND t.due_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e.family_id=?2 AND e.project_id=?1 AND e.is_task=1 AND (e.source_uid=?3||t.id OR ((e.source_uid IS NULL OR e.source_uid='') AND e.title=t.title))) ORDER BY t.id ASC`).bind(projectId, actor.familyId, "project-task:").all<any>();
  if (!tasks.results.length) return { status: 200, body: summary ? { protocol: "herewoven.project-calendar-summary.v1", state: "all-sent", eventsCreated: 0 } : { message: "All incomplete tasks are already on the calendar", eventsCreated: 0, events: [] } };
  const now = Date.now(), events: any[] = [], statements = [actorWriteCheck(db, actor), d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Project" WHERE id=?1 AND family_id=?2)`, [projectId, actor.familyId])];
  for (const task of tasks.results) { const id = randomUUID(), { start, end } = allDayRange(new Date(Number(task.due_date)), timeZone); events.push({ id, title: task.title, start_time: start, end_time: end }); statements.push(db.prepare(`INSERT INTO "Event" (id,family_id,title,description,start_time,end_time,event_type,is_task,project_id,source_uid,created_by,created_at,updated_at) SELECT ?1,?2,?3,?4,?5,?6,'other',1,?7,?8,?9,?10,?10 WHERE NOT EXISTS (SELECT 1 FROM "Event" WHERE family_id=?2 AND project_id=?7 AND is_task=1 AND (source_uid=?8 OR ((source_uid IS NULL OR source_uid='') AND title=?3)))`).bind(id, actor.familyId, task.title, task.description || `Task from project: ${project.name}`, start.getTime(), end.getTime(), projectId, projectTaskUid(task.id), actor.userId, now)); }
  const results = await db.batch(statements);
  const createdEvents = events.filter((_event, index) => Number(results[index + 2]?.meta.changes || 0) === 1);
  const created = createdEvents.length;
  if (summary) return { status: 200, body: { protocol: "herewoven.project-calendar-summary.v1", state: created ? "created" : "all-sent", eventsCreated: created } };
  return { status: 200, body: { message: created ? `Created ${created} calendar event(s)` : "All incomplete tasks are already on the calendar", eventsCreated: created, events: createdEvents } };
}
