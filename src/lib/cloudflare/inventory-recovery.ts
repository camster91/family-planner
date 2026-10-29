/** Native D1 bridge for reviewed inventory intake/change/restock recovery.
 *
 * The HTTP routes keep their existing contracts. This module only replaces the
 * PostgreSQL transaction/source for the Cloudflare backend: actor authority is
 * rechecked from D1, receipts remain the canonical idempotency records, and
 * grocery rows retain the same source_request_id/source_key provenance used by
 * the PostgreSQL implementation.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EffectResult } from "@/lib/idempotency";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { normalizeName } from "@/lib/backfill/meals-groceries";
import { canWriteInventory } from "@/lib/inventory";
import {
  inventoryChangeInput,
  inventoryChangeReceipt,
} from "@/lib/inventory-change-contract";
import {
  inventoryIntakeInput,
  inventoryIntakeReceipt,
} from "@/lib/inventory-intake-contract";
import {
  INVENTORY_RECOVERY_REVIEW_CONTRACT,
  inventoryRecoveryReview,
} from "@/lib/inventory-recovery-review-contract";
import {
  INVENTORY_RECOVERY_CONTRACT,
  inventoryRecoveryEntry,
  type InventoryRecoveryContext,
  type InventoryRecoveryEntry,
} from "@/lib/inventory-recovery-contract";
import {
  INVENTORY_RESTOCK_ACTION,
  restockInput,
  restockReceipt,
  restockReview,
  type RestockInput,
} from "@/lib/inventory-restock-contract";
import { UNDO_WINDOW_MS } from "@/lib/grocery-from-recipe-contract";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Statement, type D1Store } from "./database";
import { d1WriteCheck } from "./write-check";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";

export type D1InventoryRecoveryActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type D1InventoryActor = D1InventoryRecoveryActor;
type D1Reply = EffectResult & { replayed?: boolean };

const fail = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});

const itemSelect = {
  id: true,
  name: true,
  amount: true,
  unit: true,
  location: true,
  status: true,
  updated_at: true,
  ingredient_id: true,
} as const;

function asDate(value: unknown) {
  return value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
}

function jsonBody(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Mirrors inventoryIntakeAuthority without opening Prisma. */
export async function authorizeD1InventoryRecovery(
  db: D1ReadClient,
  actor: D1InventoryActor,
  lists = false,
): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return fail(401, "UNAUTHORIZED");
  if (!canWriteInventory(user.role)) return fail(403, "INTAKE_FORBIDDEN");
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), "inventory"))
    return fail(403, "INVENTORY_DISABLED");
  if (lists && !isFeatureEnabled(normalizeFeatures(family.features), "lists"))
    return fail(403, "LISTS_DISABLED");
  return null;
}

async function withAuthorizedRead<T>(
  actor: D1InventoryActor,
  read: (db: D1ReadClient) => Promise<T>,
  database?: D1Store,
  lists = false,
) {
  const store = database ?? await getD1Database();
  return withD1ReadClient(async db => {
    const refusal = await authorizeD1InventoryRecovery(db, actor, lists);
    return refusal ? { refusal, value: undefined as T | undefined } : { refusal: null, value: await read(db) };
  }, store as unknown as NativeD1);
}

/** The private recovery negotiation context. */
export async function readD1InventoryRecoveryContext(
  actor: D1InventoryActor,
  context: { enabled: boolean; owner: InventoryRecoveryContext["owner"] },
  database?: D1Store,
): Promise<D1Reply> {
  const result = await withAuthorizedRead(actor, async () => null, database);
  if (result.refusal) return result.refusal;
  return {
    status: 200,
    body: {
      contract: INVENTORY_RECOVERY_CONTRACT,
      ...context,
      userId: actor.userId,
      familyId: actor.familyId,
    },
  };
}

type RestockComparison = {
  item: any;
  list: { id: string; name: string; type: string } | null;
  existingSourceItemId: string | null;
  similar: Array<{ id: string; content: string }>;
  comparisonIncomplete: boolean;
};

async function compareRestock(
  db: D1ReadClient,
  actor: D1InventoryActor,
  input: { itemId?: string; item_id?: string; listId?: string; list_id?: string; content?: string },
): Promise<RestockComparison> {
  const itemId = input.itemId ?? input.item_id!;
  const listId = input.listId ?? input.list_id;
  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, family_id: actor.familyId },
    select: itemSelect,
  });
  const lists = await db.list.findMany({
    where: { family_id: actor.familyId, type: { in: ["grocery", "shopping"] } },
    select: { id: true, name: true, type: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 101,
  });
  const list = listId ? lists.slice(0, 100).find(row => row.id === listId) ?? null : null;
  if (!item || (listId && !list))
    return { item, list, existingSourceItemId: null, similar: [], comparisonIncomplete: false };
  const content = input.content ?? item.name;
  const sourceKey = `inventory:${item.id}`;
  const existing = listId
    ? await db.listItem.findFirst({
        where: { list_id: listId, checked: false, source: "manual", source_key: sourceKey },
        select: { id: true },
      })
    : null;
  const candidates = listId
    ? await db.listItem.findMany({
        where: { list_id: listId, checked: false },
        select: { id: true, content: true, ingredient_id: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 2001,
      })
    : [];
  const matches = candidates
    .slice(0, 2000)
    .filter(row => row.id !== existing?.id && (normalizeName(row.content) === normalizeName(content) || (!!item.ingredient_id && row.ingredient_id === item.ingredient_id)))
    .slice(0, 10)
    .map(row => ({ id: row.id, content: row.content }));
  return {
    item,
    list,
    existingSourceItemId: existing?.id ?? null,
    similar: matches,
    comparisonIncomplete: candidates.length > 2000,
  };
}

export async function reviewD1InventoryRestock(
  actor: D1InventoryActor,
  input: { itemId: string; listId?: string; content?: string },
  database?: D1Store,
): Promise<D1Reply> {
  const result = await withAuthorizedRead(actor, db => compareRestock(db, actor, input), database, true);
  if (result.refusal) return result.refusal;
  const comparison = result.value!;
  if (!comparison.item) return fail(404, "RESTOCK_SOURCE_UNAVAILABLE");
  if (input.listId && !comparison.list) return fail(404, "RESTOCK_LIST_UNAVAILABLE");
  // The list collection is deliberately fetched separately so a selected list
  // cannot be hidden by the 2,000-row lookalike query above.
  const listsResult = await withAuthorizedRead(actor, db => db.list.findMany({
    where: { family_id: actor.familyId, type: { in: ["grocery", "shopping"] } },
    select: { id: true, name: true, type: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 101,
  }), database, true);
  if (listsResult.refusal) return listsResult.refusal;
  const lists = listsResult.value!;
  return {
    status: 200,
    body: restockReview.parse({
      userId: actor.userId,
      familyId: actor.familyId,
      item: {
        id: comparison.item.id,
        name: comparison.item.name,
        version: asDate(comparison.item.updated_at).toISOString(),
      },
      lists: lists.slice(0, 100),
      listsTruncated: lists.length > 100,
      selectedListId: input.listId ?? null,
      existingSourceItemId: input.listId ? comparison.existingSourceItemId : null,
      similar: input.listId ? comparison.similar : [],
      comparisonIncomplete: input.listId ? comparison.comparisonIncomplete : false,
    }),
  };
}

function restockAgeExpired(input: RestockInput, now: Date) {
  const issued = new Date(input.issued_at).getTime();
  return !Number.isFinite(issued) || now.getTime() - issued < -60_000 || now.getTime() - issued > IDEMPOTENCY_TTL_MS - 3_600_000;
}

export async function persistD1InventoryRestock(
  actor: D1InventoryActor,
  input: RestockInput,
  key: string,
  database?: D1Store,
  now = new Date(),
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: INVENTORY_RESTOCK_ACTION,
    input,
    key,
    database,
    now,
    authorize: db => authorizeD1InventoryRecovery(db, actor, true),
    plan: async (db, recordId) => {
      if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId)
        return fail(403, "AUTH_CONTEXT_CHANGED");
      if (restockAgeExpired(input, now)) return fail(409, "RESTOCK_INTENT_EXPIRED");
      const comparison = await compareRestock(db, actor, { item_id: input.item_id, list_id: input.list_id, content: input.content });
      if (!comparison.item) return fail(404, "RESTOCK_SOURCE_UNAVAILABLE");
      if (!comparison.list) return fail(404, "RESTOCK_LIST_UNAVAILABLE");
      const list = comparison.list;
      if (asDate(comparison.item.updated_at).toISOString() !== input.expected_version)
        return fail(409, "RESTOCK_SOURCE_CHANGED");
      if (comparison.item.ingredient_id) {
        const ingredient = await db.ingredient.findFirst({ where: { id: comparison.item.ingredient_id, family_id: actor.familyId }, select: { id: true } });
        if (!ingredient) return fail(404, "RESTOCK_SOURCE_UNAVAILABLE");
      }
      if (!comparison.existingSourceItemId && !input.allow_similar && (comparison.similar.length > 0 || comparison.comparisonIncomplete))
        return fail(409, "RESTOCK_DUPLICATE_REVIEW_REQUIRED");
      const listItemId = comparison.existingSourceItemId ?? randomUUID();
      const created = comparison.existingSourceItemId === null;
      const requestId = recordId ?? randomUUID();
      const body = restockReceipt.parse({
        itemId: listItemId,
        listId: list.id,
        requestId,
        created,
        undoExpiresAt: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(),
      });
      return {
        status: 201,
        body,
        effects: created
          ? (session: Pick<D1Store, "prepare">): D1Statement[] => [
              session.prepare(`INSERT INTO "ListItem"
                (id,list_id,content,checked,quantity,added_by,position,ingredient_id,amount,unit,source,source_key,source_request_id,created_at,updated_at)
                SELECT ?1,?2,?3,0,1,?4,COALESCE((SELECT MAX(position)+1 FROM "ListItem" WHERE list_id=?2),0),?5,?6,?7,'manual',?8,?9,?10,?10
                WHERE EXISTS (SELECT 1 FROM "List" WHERE id=?2 AND family_id=?11 AND type IN ('grocery','shopping'))
                  AND NOT EXISTS (SELECT 1 FROM "ListItem" WHERE list_id=?2 AND checked=0 AND source='manual' AND source_key=?8)`)
                .bind(listItemId, list.id, input.content, actor.userId, comparison.item.ingredient_id ?? null, input.amount, input.unit ?? null, `inventory:${comparison.item.id}`, requestId, now.getTime(), actor.familyId),
              d1WriteCheck(session, "changes()=1"),
            ]
          : undefined,
      };
    },
  });
}

export async function confirmD1InventoryRestock(
  actor: D1InventoryActor,
  result: EffectResult,
  input: RestockInput,
  database?: D1Store,
): Promise<D1Reply> {
  if (result.status !== 201) return result;
  const receipt = restockReceipt.safeParse(result.body);
  if (!receipt.success) return fail(409, "RESTOCK_CONFIRMATION_UNAVAILABLE");
  const checked = await withAuthorizedRead(actor, async db => {
    const record = await db.idempotencyRecord.findUnique({ where: { id: receipt.data.requestId }, select: { family_id: true, user_id: true, action: true, request_hash: true, response_status: true, response_body: true } });
    if (!record || record.family_id !== actor.familyId || record.user_id !== actor.userId || record.action !== INVENTORY_RESTOCK_ACTION || record.request_hash !== hashIdempotentRequest(INVENTORY_RESTOCK_ACTION, input) || record.response_status !== 201) return false;
    const stored = restockReceipt.safeParse(jsonBody(record.response_body));
    if (!stored.success || hashIdempotentRequest("restock.receipt", stored.data) !== hashIdempotentRequest("restock.receipt", receipt.data)) return false;
    const list = await db.list.findFirst({ where: { id: receipt.data.listId, family_id: actor.familyId }, select: { id: true } });
    if (!list) return false;
    const row = await db.listItem.findFirst({ where: { id: receipt.data.itemId, list_id: receipt.data.listId, ...(receipt.data.created ? { source_request_id: receipt.data.requestId, added_by: actor.userId } : {}) }, select: { id: true } });
    return Boolean(row);
  }, database, true);
  if (checked.refusal) return checked.refusal;
  return checked.value ? { status: result.status, body: receipt.data } : fail(409, "RESTOCK_ORIGINAL_REMOVED");
}

export async function undoD1InventoryRestock(
  actor: D1InventoryActor,
  requestId: string,
  database?: D1Store,
  now = new Date(),
): Promise<D1Reply> {
  return executeD1PersonEffect({
    actor,
    action: "grocery.add-from-inventory.undo",
    input: { requestId },
    key: null,
    database,
    now,
    authorize: db => authorizeD1InventoryRecovery(db, actor, true),
    plan: async db => {
      const record = await db.idempotencyRecord.findFirst({ where: { id: requestId, family_id: actor.familyId, action: INVENTORY_RESTOCK_ACTION }, select: { user_id: true, created_at: true, response_status: true } });
      if (!record) return fail(404, "UNDO_NOT_FOUND");
      if (record.user_id !== actor.userId) return fail(403, "UNDO_NOT_ALLOWED");
      if (record.response_status === null) return fail(409, "UNDO_IN_PROGRESS");
      const cutoff = new Date(now.getTime() - UNDO_WINDOW_MS).getTime();
      if (asDate(record.created_at).getTime() < cutoff) return fail(409, "UNDO_WINDOW_EXPIRED");
      const scope = { source_request_id: requestId, added_by: actor.userId };
      const [open, checked] = await Promise.all([
        db.listItem.count({ where: { ...scope, checked: false, created_at: { gte: new Date(cutoff) }, list: { family_id: actor.familyId } } }),
        db.listItem.count({ where: { ...scope, checked: true, list: { family_id: actor.familyId } } }),
      ]);
      return {
        status: 200,
        body: { requestId, removedCount: open, keptCheckedCount: checked },
        effects: open > 0
          ? (session: Pick<D1Store, "prepare">): D1Statement[] => [session.prepare(`DELETE FROM "ListItem" WHERE source_request_id=?1 AND added_by=?2 AND checked=0 AND created_at>=?3 AND EXISTS (SELECT 1 FROM "List" WHERE "List".id="ListItem".list_id AND "List".family_id=?4)`).bind(requestId, actor.userId, cutoff, actor.familyId)]
          : undefined,
      };
    },
  });
}

function recoveryAction(kind: InventoryRecoveryEntry["kind"]) {
  return kind === "intake" ? "inventory.intake.v1" : kind === "restock" ? INVENTORY_RESTOCK_ACTION : "inventory.change.v1";
}

function recoveryExpectedStatus(kind: InventoryRecoveryEntry["kind"]) {
  return kind === "intake" || kind === "restock" ? 201 : 200;
}

function recoveryInput(entry: InventoryRecoveryEntry): any {
  const raw = JSON.parse(entry.body);
  return entry.kind === "intake" ? inventoryIntakeInput.parse(raw) : entry.kind === "restock" ? restockInput.parse(raw) : inventoryChangeInput.parse(raw);
}

function recoveryReply(
  ownerScope: string,
  entry: InventoryRecoveryEntry,
  state: z.infer<typeof inventoryRecoveryReview>["state"],
  name: string | null,
  current: any = null,
  receipt: any = null,
  targetList?: { id: string; name: string },
): D1Reply {
  const body = inventoryRecoveryReview.parse({
    contract: INVENTORY_RECOVERY_REVIEW_CONTRACT,
    ownerScope,
    entry,
    state,
    canRetry: state === "ready",
    name,
    current,
    receipt,
        // The public recovery contract intentionally exposes only the exact
        // target identity. The D1 comparison query also carries the list type
        // for its own filtering, but that internal field must never cross this
        // strict response boundary.
        ...(targetList
          ? { targetList: { id: targetList.id, name: targetList.name } }
          : {}),
  });
  return { status: 200, body };
}

export async function reviewD1InventoryRecovery(
  actor: D1InventoryActor,
  entryInput: InventoryRecoveryEntry,
  ownerScope: string,
  database?: D1Store,
  now = new Date(),
): Promise<D1Reply> {
  const entry = inventoryRecoveryEntry.parse(entryInput);
  const input = recoveryInput(entry);
  const needsLists = entry.kind === "restock";
  const result = await withAuthorizedRead(actor, async db => {
    if (input.expected_user_id !== actor.userId || input.expected_family_id !== actor.familyId)
      return recoveryReply(ownerScope, entry, "conflict", null);
    const action = recoveryAction(entry.kind);
    const expectedStatus = recoveryExpectedStatus(entry.kind);
    const record = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope: `user:${actor.userId}`, key: entry.key } }, select: { id: true, family_id: true, user_id: true, action: true, request_hash: true, response_status: true, response_body: true, expires_at: true, created_at: true } });
    if (record && (record.family_id !== actor.familyId || record.user_id !== actor.userId || record.action !== action || record.request_hash !== hashIdempotentRequest(action, input)))
      return recoveryReply(ownerScope, entry, "conflict", null);
    const body = jsonBody(record?.response_body);
    if (record?.response_status === expectedStatus) {
      if (entry.kind === "restock") {
        const proof = restockReceipt.safeParse(body);
        const restock = restockInput.parse(input);
        const list = await db.list.findFirst({ where: { id: restock.list_id, family_id: actor.familyId, type: { in: ["grocery", "shopping"] } }, select: { id: true, name: true } });
        if (!proof.success || !list || proof.data.listId !== list.id) return recoveryReply(ownerScope, entry, "unavailable", null);
        const row = await db.listItem.findFirst({ where: { id: proof.data.itemId, list_id: proof.data.listId, list: { family_id: actor.familyId }, ...(proof.data.created ? { source_request_id: proof.data.requestId, added_by: actor.userId } : {}) }, select: { id: true, content: true } });
        return recoveryReply(ownerScope, entry, row ? "committed" : "removed", row?.content ?? null, null, proof.data, list);
      }
      if (entry.kind === "intake") {
        const proof = inventoryIntakeReceipt.safeParse(body);
        if (!proof.success) return recoveryReply(ownerScope, entry, "unavailable", null);
        const item = await db.inventoryItem.findFirst({ where: { id: proof.data.itemId, family_id: actor.familyId }, select: itemSelect });
        return recoveryReply(ownerScope, entry, item ? "committed" : "removed", item?.name ?? null, item ? currentDto(item) : null, proof.data);
      }
      const proof = inventoryChangeReceipt.safeParse(body);
      const operation = inventoryChangeInput.parse(input).operation;
      if (!proof.success || proof.data.kind !== operation.kind || (operation.kind === "undo" ? (proof.data as { adjustmentId: string }).adjustmentId !== operation.adjustment_id : proof.data.itemId !== operation.item_id)) return recoveryReply(ownerScope, entry, "unavailable", null);
      if (operation.kind === "remove") return recoveryReply(ownerScope, entry, "committed", null, null, proof.data);
      const item = await db.inventoryItem.findFirst({ where: { id: proof.data.itemId, family_id: actor.familyId }, select: itemSelect });
      if (!item) return recoveryReply(ownerScope, entry, "removed", null, null, proof.data);
      if (operation.kind === "undo") {
        const adjustment = await db.inventoryAdjustment.findFirst({ where: { id: operation.adjustment_id, item_id: item.id, family_id: actor.familyId }, select: { id: true } });
        if (!adjustment) return recoveryReply(ownerScope, entry, "unavailable", null);
      }
      return recoveryReply(ownerScope, entry, "committed", item.name, currentDto(item), proof.data);
    }
    if (record?.response_status === null) return recoveryReply(ownerScope, entry, "pending", null);
    const issued = new Date(input.issued_at).getTime();
    if (now.getTime() - issued < -60_000 || now.getTime() - issued > IDEMPOTENCY_TTL_MS - 3_600_000 || (record && asDate(record.expires_at).getTime() <= now.getTime())) return recoveryReply(ownerScope, entry, "expired", null);
    if (record) return recoveryReply(ownerScope, entry, "unavailable", null);
    if (entry.kind === "restock") {
      const restock = restockInput.parse(input);
      const comparison = await compareRestock(db, actor, { item_id: restock.item_id, list_id: restock.list_id, content: restock.content });
      if (!comparison.item || !comparison.list || asDate(comparison.item.updated_at).toISOString() !== restock.expected_version) return recoveryReply(ownerScope, entry, "unavailable", null);
      if (!comparison.existingSourceItemId && !restock.allow_similar && (comparison.similar.length > 0 || comparison.comparisonIncomplete)) return recoveryReply(ownerScope, entry, "conflict", null, null, null, comparison.list);
      return recoveryReply(ownerScope, entry, "ready", restock.content, null, null, comparison.list);
    }
    if (entry.kind === "intake") {
      const intake = inventoryIntakeInput.parse(input);
      if (intake.item.ingredient_id && !(await db.ingredient.findFirst({ where: { id: intake.item.ingredient_id, family_id: actor.familyId }, select: { id: true } }))) return recoveryReply(ownerScope, entry, "unavailable", null);
      return recoveryReply(ownerScope, entry, "ready", intake.item.name);
    }
    const operation = inventoryChangeInput.parse(input).operation;
    if (operation.kind === "undo") {
      const adjustment = await db.inventoryAdjustment.findFirst({ where: { id: operation.adjustment_id, family_id: actor.familyId }, select: { id: true, item_id: true } });
      const item = adjustment ? await db.inventoryItem.findFirst({ where: { id: adjustment.item_id, family_id: actor.familyId }, select: itemSelect }) : null;
      return adjustment && item ? recoveryReply(ownerScope, entry, "ready", item.name, currentDto(item)) : recoveryReply(ownerScope, entry, "unavailable", null);
    }
    const item = await db.inventoryItem.findFirst({ where: { id: operation.item_id, family_id: actor.familyId }, select: itemSelect });
    if (!item) return recoveryReply(ownerScope, entry, "unavailable", null);
    return asDate(item.updated_at).toISOString() === operation.expected_version && item.status === "active"
      ? recoveryReply(ownerScope, entry, "ready", item.name, currentDto(item))
      : recoveryReply(ownerScope, entry, "conflict", item.name, currentDto(item));
  }, database, needsLists);
  if (result.refusal) return result.refusal;
  return result.value!;
}

function currentDto(item: any) {
  return {
    amount: item.amount === null || item.amount === undefined ? null : Number(item.amount),
    unit: item.unit ?? null,
    location: item.location,
    status: item.status,
    updatedAt: asDate(item.updated_at).toISOString(),
  };
}
