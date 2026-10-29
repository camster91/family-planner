/** Native D1 wishlist reads and mutation effects.
 *
 * The public wishlist routes keep their PostgreSQL contract while this module
 * owns the D1 path.  Reads use the restricted D1 client; writes use explicit
 * SQL checks and person receipts so membership, role, feature and household
 * boundaries are re-checked at the commit boundary.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { encodeWishlistCursor, type WishlistPaging } from "@/lib/wishlist-paging";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import type { D1ReadClient } from "./read-client";
import { d1WriteCheck } from "./write-check";

export type D1WishlistActor = AssistantProofActor;
type NativeResult = EffectResult & { replayed?: boolean };

const failure = (status: number, error: string): EffectResult => ({ status, body: { error } });
const forbidden = (): EffectResult => failure(403, "Forbidden");
const parentOnly = (): EffectResult => failure(403, "Only parents can perform this action");

function storedFeatures(value: unknown) {
  return normalizeFeatures(typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return {}; }
  })() : value);
}

async function authority(db: D1ReadClient, actor: D1WishlistActor): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (!family || !isFeatureEnabled(storedFeatures(family.features), "wishlist"))
    return failure(403, "This feature is turned off for your family");
  return null;
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function epoch(value: unknown): number {
  const date = dateValue(value);
  if (!date) throw new Error("Invalid wishlist timestamp");
  return date.getTime();
}

function itemDto(row: any, requester?: any, statusChanger?: any) {
  const item = {
    id: row.id,
    family_id: row.family_id,
    requested_by: row.requested_by,
    title: row.title,
    link: row.link ?? null,
    description: row.description ?? null,
    approx_price: row.approx_price == null ? null : String(row.approx_price),
    status: row.status,
    denied_reason: row.denied_reason ?? null,
    status_changed_at: dateValue(row.status_changed_at),
    status_changed_by: row.status_changed_by ?? null,
    created_at: dateValue(row.created_at),
    updated_at: dateValue(row.updated_at),
  };
  return {
    ...item,
    ...(requester === undefined ? {} : { requester: requester ? { id: requester.id, name: requester.name } : null }),
    ...(statusChanger === undefined ? {} : { status_changer: statusChanger ? { id: statusChanger.id, name: statusChanger.name } : null }),
  };
}

type WishlistCursorRow = { id: string; created_at: Date };

/** Keep the nullable DTO timestamp out of the cursor encoder's contract. */
function cursorRow(value: { id?: unknown; created_at?: unknown } | undefined): WishlistCursorRow | null {
  if (!value || typeof value.id !== "string" || !(value.created_at instanceof Date)) return null;
  return { id: value.id, created_at: value.created_at };
}

async function findItem(db: D1ReadClient, actor: D1WishlistActor, id: string) {
  return db.wishlistItem.findFirst({
    where: { id, family_id: actor.familyId },
    include: {
      requester: { select: { id: true, name: true } },
      status_changer: { select: { id: true, name: true } },
    },
  });
}

async function mutationAuthority(
  db: D1ReadClient,
  actor: D1WishlistActor,
  mutation: "update" | "delete" | "status",
  id: string,
): Promise<EffectResult | null> {
  const denied = await authority(db, actor);
  if (denied) return denied;
  if (mutation === "status" && actor.role !== "parent") return parentOnly();
  const item = await findItem(db, actor, id);
  // A missing delete/status row is allowed through the receipt authorizer so
  // a completed keyed replay remains safe after its target was removed.  The
  // effect plan still returns 404 for a new mutation.
  if (!item) return mutation === "update" ? failure(404, "Not found") : null;
  if ((mutation === "update" || mutation === "delete") && item.requested_by !== actor.userId && actor.role !== "parent") return forbidden();
  return null;
}

/** Collection read with the exact scope used to validate/encode its cursor. */
export async function readD1WishlistScoped(
  actor: D1WishlistActor,
  scope: { requesterId: string | null },
  paging: WishlistPaging,
  database?: D1Store,
): Promise<NativeResult> {
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const { withD1ReadClient } = await import("./read-client");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const values: SqlValue[] = [actor.familyId];
  let where = `w.family_id=?1`;
  if (paging.ok && paging.paged && scope.requesterId) {
    values.push(scope.requesterId);
    where += ` AND w.requested_by=?${values.length}`;
  }
  if (paging.ok && paging.paged && paging.cursor) {
    values.push(paging.cursor.createdAt.getTime(), paging.cursor.id);
    where += ` AND (w.created_at<?${values.length - 1} OR (w.created_at=?${values.length - 1} AND w.id>?${values.length}))`;
  }
  const limit = paging.ok && paging.paged ? paging.limit + 1 : 10000;
  const rows = await db.prepare(`SELECT w.*,ru.id AS requester_id,ru.name AS requester_name,su.id AS status_changer_id,su.name AS status_changer_name
    FROM "WishlistItem" w JOIN "User" ru ON ru.id=w.requested_by AND ru.family_id=w.family_id
    LEFT JOIN "User" su ON su.id=w.status_changed_by AND su.family_id=w.family_id
    WHERE ${where} ORDER BY w.created_at DESC,w.id ASC LIMIT ${limit}`).bind(...values).all<any>();
  const page = rows.results.slice(0, paging.ok && paging.paged ? paging.limit : undefined);
  const items = page.map((row) => itemDto(row,
    row.requester_id ? { id: row.requester_id, name: row.requester_name } : null,
    row.status_changer_id ? { id: row.status_changer_id, name: row.status_changer_name } : null));
  const body: Record<string, unknown> = { items };
  if (paging.ok && paging.paged) {
    const lastItem = cursorRow(items[items.length - 1]);
    // D1 rows contain epoch milliseconds; itemDto normalizes created_at to a
    // Date before the cursor encoder serializes it.
    body.nextCursor = rows.results.length > paging.limit && lastItem
      ? encodeWishlistCursor({ familyId: actor.familyId, requesterId: scope.requesterId }, lastItem) : null;
  }
  return { status: 200, body };
}

export async function readD1WishlistItem(actor: D1WishlistActor, id: string, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const { withD1ReadClient } = await import("./read-client");
  const denied = await withD1ReadClient((read) => authority(read, actor), store as any);
  if (denied) return denied;
  const row = await db.prepare(`SELECT w.*,ru.id AS requester_id,ru.name AS requester_name,su.id AS status_changer_id,su.name AS status_changer_name
    FROM "WishlistItem" w JOIN "User" ru ON ru.id=w.requested_by AND ru.family_id=w.family_id
    LEFT JOIN "User" su ON su.id=w.status_changed_by AND su.family_id=w.family_id
    WHERE w.id=?1 AND w.family_id=?2`).bind(id, actor.familyId).first<any>();
  if (!row) return failure(404, "Not found");
  return { status: 200, body: { item: itemDto(row,
    row.requester_id ? { id: row.requester_id, name: row.requester_name } : null,
    row.status_changer_id ? { id: row.status_changer_id, name: row.status_changer_name } : null) } };
}

export function createD1Wishlist(actor: D1WishlistActor, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "wishlist.create", input, key, database,
    authorize: (db) => authority(db, actor),
    plan: async (db) => {
      const requester = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } });
      if (!requester) return failure(401, "Unauthorized");
      const now = new Date(), id = randomUUID();
      const item = itemDto({ id, family_id: actor.familyId, requested_by: actor.userId, title: input.title,
        link: input.link || null, description: input.description || null, approx_price: input.approx_price == null ? null : input.approx_price,
        status: "idle", denied_reason: null, status_changed_at: null, status_changed_by: null, created_at: now, updated_at: now }, requester);
      return { status: 201, body: { item }, effects: (session) => [session.prepare(`INSERT INTO "WishlistItem" (id,family_id,requested_by,title,link,description,approx_price,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'idle',?8,?8)`).bind(id, actor.familyId, actor.userId, input.title, input.link || null, input.description || null, input.approx_price == null ? null : input.approx_price, now.getTime())] };
    },
  });
}

export function updateD1Wishlist(actor: D1WishlistActor, id: string, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "wishlist.update", input: { id, ...input }, key, database,
    authorize: (db) => mutationAuthority(db, actor, "update", id),
    plan: async (db) => {
      const row = await findItem(db, actor, id);
      if (!row) return failure(404, "Not found");
      const previousUpdatedAt = epoch(row.updated_at);
      const now = new Date(Math.max(Date.now(), previousUpdatedAt + 1));
      const next = { ...row, title: input.title === undefined ? row.title : input.title, link: input.link === undefined ? row.link : input.link || null, description: input.description === undefined ? row.description : input.description || null, approx_price: input.approx_price === undefined ? row.approx_price : input.approx_price, updated_at: now };
      const requester = (row as any).requester;
      const item = itemDto(next, requester);
      return { status: 200, body: { item }, effects: (session) => [
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "WishlistItem" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [id, actor.familyId, previousUpdatedAt]),
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`, [actor.userId, actor.familyId, actor.role, actor.generation]),
        session.prepare(`UPDATE "WishlistItem" SET title=?3,link=?4,description=?5,approx_price=?6,updated_at=?7 WHERE id=?1 AND family_id=?2 AND updated_at=?8`).bind(id, actor.familyId, next.title, next.link, next.description, next.approx_price == null ? null : Number(next.approx_price), now.getTime(), previousUpdatedAt),
        d1WriteCheck(session, "changes()=1"),
      ] };
    },
  });
}

export function deleteD1Wishlist(actor: D1WishlistActor, id: string, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "wishlist.delete", input: { id }, key, database,
    authorize: (db) => mutationAuthority(db, actor, "delete", id),
    plan: async (db) => {
      if (!(await findItem(db, actor, id))) return failure(404, "Not found");
      return { status: 200, body: { success: true }, effects: (session) => [
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "WishlistItem" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`, [actor.userId, actor.familyId, actor.role, actor.generation]),
        session.prepare(`DELETE FROM "WishlistItem" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
        d1WriteCheck(session, "changes()=1"),
      ] };
    },
  });
}

export function updateD1WishlistStatus(actor: D1WishlistActor, id: string, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "wishlist.status", input: { id, ...input }, key, database,
    authorize: (db) => mutationAuthority(db, actor, "status", id),
    plan: async (db) => {
      const row = await findItem(db, actor, id);
      if (!row) return failure(404, "Not found");
      const previousUpdatedAt = epoch(row.updated_at);
      const now = new Date(Math.max(Date.now(), previousUpdatedAt + 1)), requester = (row as any).requester, changer = { id: actor.userId, name: (await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } }))?.name ?? "" };
      const next = { ...row, status: input.status, denied_reason: input.status === "denied" ? (input.denied_reason ?? "").trim() : null, status_changed_at: now, status_changed_by: actor.userId, updated_at: now };
      return { status: 200, body: { item: itemDto(next, requester, changer) }, effects: (session) => [
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "WishlistItem" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [id, actor.familyId, previousUpdatedAt]),
        d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
        session.prepare(`UPDATE "WishlistItem" SET status=?3,denied_reason=?4,status_changed_at=?5,status_changed_by=?6,updated_at=?5 WHERE id=?1 AND family_id=?2 AND updated_at=?7`).bind(id, actor.familyId, next.status, next.denied_reason, now.getTime(), actor.userId, previousUpdatedAt),
        d1WriteCheck(session, "changes()=1"),
      ] };
    },
  });
}
