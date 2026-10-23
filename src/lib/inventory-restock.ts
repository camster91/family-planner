/** Canonical InventoryItem -> reviewed ListItem. No stock update or second stock model. */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  inventoryIntakeAuthority,
  type InventoryIntakeActor,
} from "@/lib/inventory-intake";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { createListItem } from "@/lib/list-item-create";
import { normalizeName } from "@/lib/backfill/meals-groceries";
import { undoGroceryAdd, UNDO_WINDOW_MS } from "@/lib/grocery-from-recipe";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import {
  INVENTORY_RESTOCK_ACTION,
  restockReceipt,
  restockReview,
  type RestockInput,
} from "@/lib/inventory-restock-contract";
type Db = Pick<PrismaClient, "$transaction">;
const fail = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
const sourceKey = (id: string) => `inventory:${id}`;
export async function restockAuthority(
  tx: Prisma.TransactionClient,
  actor: InventoryIntakeActor,
) {
  const refusal = await inventoryIntakeAuthority(tx, actor);
  if (refusal) return refusal;
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  return family && isFeatureEnabled(normalizeFeatures(family.features), "lists")
    ? null
    : fail(403, "LISTS_DISABLED");
}
export async function compareInventoryRestock(
  tx: Prisma.TransactionClient,
  familyId: string,
  listId: string,
  itemId: string,
  content: string,
  ingredientId: string | null,
) {
  const existing = await tx.listItem.findFirst({
    where: {
      list_id: listId,
      list: { family_id: familyId },
      checked: false,
      source: "manual",
      source_key: sourceKey(itemId),
    },
    select: { id: true },
  });
  const candidates = await tx.listItem.findMany({
    where: { list_id: listId, list: { family_id: familyId }, checked: false },
    select: { id: true, content: true, ingredient_id: true },
    orderBy: { id: "asc" },
    take: 2001,
  });
  const matches = candidates
    .slice(0, 2000)
    .filter(
      (row) =>
        row.id !== existing?.id &&
        (normalizeName(row.content) === normalizeName(content) ||
          (!!ingredientId && row.ingredient_id === ingredientId)),
    );
  return {
    existingSourceItemId: existing?.id ?? null,
    similar: matches.slice(0, 10).map(({ id, content }) => ({ id, content })),
    comparisonIncomplete: candidates.length > 2000 || matches.length > 10,
  };
}
export async function reviewInventoryRestock(
  db: Db,
  actor: InventoryIntakeActor,
  input: { itemId: string; listId?: string; content?: string },
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const refusal = await restockAuthority(tx, actor);
    if (refusal) return refusal;
    const item = await tx.inventoryItem.findFirst({
      where: { id: input.itemId, family_id: actor.familyId },
      select: { id: true, name: true, updated_at: true, ingredient_id: true },
    });
    if (!item) return fail(404, "RESTOCK_SOURCE_UNAVAILABLE");
    const lists = await tx.list.findMany({
      where: {
        family_id: actor.familyId,
        type: { in: ["grocery", "shopping"] },
      },
      select: { id: true, name: true, type: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 101,
    });
    if (
      input.listId &&
      !lists.slice(0, 100).some((list) => list.id === input.listId)
    )
      return fail(404, "RESTOCK_LIST_UNAVAILABLE");
    const comparison = input.listId
      ? await compareInventoryRestock(
          tx,
          actor.familyId,
          input.listId,
          item.id,
          input.content ?? item.name,
          item.ingredient_id,
        )
      : {
          existingSourceItemId: null,
          similar: [],
          comparisonIncomplete: false,
        };
    const parsed = restockReview.safeParse({
      userId: actor.userId,
      familyId: actor.familyId,
      item: {
        id: item.id,
        name: item.name,
        version: item.updated_at.toISOString(),
      },
      lists: lists.slice(0, 100),
      listsTruncated: lists.length > 100,
      selectedListId: input.listId ?? null,
      ...comparison,
    });
    return parsed.success
      ? { status: 200, body: parsed.data }
      : fail(409, "RESTOCK_REVIEW_UNAVAILABLE");
  });
}
export async function persistInventoryRestock(
  db: Db,
  actor: InventoryIntakeActor,
  input: RestockInput,
  recordId: string,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const refusal = await restockAuthority(tx, actor);
    if (refusal) return refusal;
    if (
      input.expected_user_id !== actor.userId ||
      input.expected_family_id !== actor.familyId
    )
      return fail(403, "AUTH_CONTEXT_CHANGED");
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: INVENTORY_RESTOCK_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_RESTOCK_ACTION, input),
      },
      select: { response_status: true, response_body: true, created_at: true },
    });
    if (!record) return fail(409, "IDEMPOTENCY_IN_PROGRESS");
    if (record.response_status !== null)
      return { status: record.response_status, body: record.response_body };
    const age = Date.now() - new Date(input.issued_at).getTime();
    if (age < -60000 || age > IDEMPOTENCY_TTL_MS - 3600000)
      return fail(409, "RESTOCK_INTENT_EXPIRED");
    const item = await tx.inventoryItem.findFirst({
      where: { id: input.item_id, family_id: actor.familyId },
      select: { id: true, updated_at: true, ingredient_id: true },
    });
    if (!item) return fail(404, "RESTOCK_SOURCE_UNAVAILABLE");
    if (item.updated_at.toISOString() !== input.expected_version)
      return fail(409, "RESTOCK_SOURCE_CHANGED");
    const list = await tx.list.findFirst({
      where: {
        id: input.list_id,
        family_id: actor.familyId,
        type: { in: ["grocery", "shopping"] },
      },
      select: { id: true },
    });
    if (!list) return fail(404, "RESTOCK_LIST_UNAVAILABLE");
    const comparison = await compareInventoryRestock(
      tx,
      actor.familyId,
      list.id,
      item.id,
      input.content,
      item.ingredient_id,
    );
    let listItemId = comparison.existingSourceItemId;
    const created = !listItemId;
    if (!listItemId) {
      if (
        !input.allow_similar &&
        (comparison.similar.length || comparison.comparisonIncomplete)
      )
        return fail(409, "RESTOCK_DUPLICATE_REVIEW_REQUIRED");
      const result = await createListItem(
        tx,
        {
          listId: list.id,
          content: input.content,
          quantity: 1,
          amount: input.amount,
          unit: input.unit ?? undefined,
          ingredient_id: item.ingredient_id ?? undefined,
        },
        { familyId: actor.familyId, addedBy: actor.userId },
        {
          groceryOnly: true,
          sourceRequestId: recordId,
          inventorySourceKey: sourceKey(item.id),
        },
      );
      if (!result.ok) return fail(409, "RESTOCK_TARGET_UNAVAILABLE");
      if (typeof result.item.id !== "string")
        throw new Error("Restock confirmation unavailable");
      listItemId = result.item.id;
    }
    const body = restockReceipt.parse({
      itemId: listItemId,
      listId: list.id,
      requestId: recordId,
      created,
      undoExpiresAt: new Date(
        record.created_at.getTime() + UNDO_WINDOW_MS,
      ).toISOString(),
    });
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 201, response_body: body },
    });
    return { status: 201, body };
  });
}
export async function confirmInventoryRestock(
  db: Db,
  actor: InventoryIntakeActor,
  result: EffectResult,
  input: RestockInput,
): Promise<EffectResult> {
  if (result.status !== 201) return result;
  const parsed = restockReceipt.safeParse(result.body);
  if (!parsed.success) return fail(409, "RESTOCK_CONFIRMATION_UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const refusal = await restockAuthority(tx, actor);
    if (refusal) return refusal;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: parsed.data.requestId,
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: INVENTORY_RESTOCK_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_RESTOCK_ACTION, input),
        response_status: 201,
      },
      select: { response_body: true },
    });
    if (
      !receipt ||
      hashIdempotentRequest("restock.receipt", receipt.response_body) !==
        hashIdempotentRequest("restock.receipt", parsed.data)
    )
      return fail(409, "RESTOCK_CONFIRMATION_UNAVAILABLE");
    const row = await tx.listItem.findFirst({
      where: {
        id: parsed.data.itemId,
        list_id: parsed.data.listId,
        list: { family_id: actor.familyId },
        ...(parsed.data.created
          ? { source_request_id: parsed.data.requestId, added_by: actor.userId }
          : {}),
      },
      select: { id: true },
    });
    return row ? result : fail(409, "RESTOCK_ORIGINAL_REMOVED");
  });
}
export async function undoInventoryRestock(
  db: Db,
  actor: InventoryIntakeActor,
  requestId: string,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const refusal = await restockAuthority(tx, actor);
    if (refusal) return refusal;
    return undoGroceryAdd(
      tx,
      requestId,
      { id: actor.userId, family_id: actor.familyId },
      INVENTORY_RESTOCK_ACTION,
    );
  });
}
