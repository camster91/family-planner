/** Canonical edit/remove primitives; caller owns authority, receipt and transaction. */
import type { Prisma } from "@prisma/client";
import {
  cleanItemName,
  resolveInventoryIngredient,
  updateInventorySchema,
} from "@/lib/inventory";
import {
  nextItemVersion,
  InventoryChangeConflict,
} from "@/lib/inventory-adjust";
import { parseDateOnly } from "@/lib/dates";
import type { z } from "zod";
export type InventoryEditResult =
  | { ok: true; itemId: string }
  | { ok: false; reason: "NOT_FOUND" | "FINISHED" | "CONFLICT" };
type Target = { familyId: string; itemId: string; expectedVersion?: string };
async function reviewedItem(tx: Prisma.TransactionClient, input: Target) {
  await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${input.itemId} AND "family_id" = ${input.familyId} FOR UPDATE`;
  return tx.inventoryItem.findFirst({
    where: { id: input.itemId, family_id: input.familyId },
    select: { id: true, name: true, status: true, updated_at: true },
  });
}
export async function editInventoryItemInTransaction(
  tx: Prisma.TransactionClient,
  input: Target & { changes: z.infer<typeof updateInventorySchema> },
): Promise<InventoryEditResult> {
  const item = await reviewedItem(tx, input);
  if (!item) return { ok: false, reason: "NOT_FOUND" };
  if (
    input.expectedVersion &&
    new Date(input.expectedVersion).getTime() !==
      new Date(item.updated_at).getTime()
  )
    return { ok: false, reason: "CONFLICT" };
  if (item.status !== "active") return { ok: false, reason: "FINISHED" };
  const data = input.changes;
  const update: Prisma.InventoryItemUncheckedUpdateManyInput = {};
  const name = data.name !== undefined ? cleanItemName(data.name) : undefined;
  if (name !== undefined) update.name = name;
  if (
    data.ingredient_id !== undefined ||
    (name !== undefined && name !== item.name)
  )
    update.ingredient_id = await resolveInventoryIngredient(
      tx,
      input.familyId,
      name ?? item.name,
      data.ingredient_id,
    );
  if (data.amount !== undefined) update.amount = data.amount;
  if (data.unit !== undefined) update.unit = data.unit;
  if (data.location !== undefined) update.location = data.location;
  if (data.expires_on !== undefined)
    update.expires_on = data.expires_on ? parseDateOnly(data.expires_on) : null;
  if (data.date_kind !== undefined) update.date_kind = data.date_kind;
  if (data.category !== undefined) update.category = data.category;
  if (data.purchased_on !== undefined)
    update.purchased_on = data.purchased_on
      ? parseDateOnly(data.purchased_on)
      : null;
  if (data.opened_on !== undefined)
    update.opened_on = data.opened_on ? parseDateOnly(data.opened_on) : null;
  update.updated_at = nextItemVersion(item.updated_at);
  const result = await tx.inventoryItem.updateMany({
    where: {
      id: item.id,
      family_id: input.familyId,
      status: "active",
      updated_at: item.updated_at,
    },
    data: update,
  });
  if (result.count !== 1) throw new InventoryChangeConflict();
  return { ok: true, itemId: item.id };
}
export async function removeInventoryItemInTransaction(
  tx: Prisma.TransactionClient,
  input: Target,
): Promise<InventoryEditResult> {
  const item = await reviewedItem(tx, input);
  if (!item) return { ok: false, reason: "NOT_FOUND" };
  if (
    input.expectedVersion &&
    new Date(input.expectedVersion).getTime() !==
      new Date(item.updated_at).getTime()
  )
    return { ok: false, reason: "CONFLICT" };
  const result = await tx.inventoryItem.deleteMany({
    where: {
      id: item.id,
      family_id: input.familyId,
      updated_at: item.updated_at,
    },
  });
  if (result.count !== 1) throw new InventoryChangeConflict();
  return { ok: true, itemId: item.id };
}
