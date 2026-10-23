import { z } from "zod";
import { updateInventorySchema } from "@/lib/inventory";
const id = z.string().min(1).max(128);
const version = z.string().datetime();
export const inventoryChangeOperation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("consume"),
      item_id: id,
      expected_version: version,
      amount: z.number().finite().gt(0).max(100000).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("discard"),
      item_id: id,
      expected_version: version,
    })
    .strict(),
  z.object({ kind: z.literal("undo"), adjustment_id: id }).strict(),
  z
    .object({
      kind: z.literal("edit"),
      item_id: id,
      expected_version: version,
      changes: updateInventorySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove"),
      item_id: id,
      expected_version: version,
    })
    .strict(),
]);
export const inventoryChangeInput = z
  .object({
    protocol: z.literal("herewoven.inventory-change.v1"),
    expected_user_id: id,
    expected_family_id: id,
    issued_at: z.string().datetime(),
    operation: inventoryChangeOperation,
  })
  .strict();
export const inventoryChangeReceipt = z.discriminatedUnion("kind", [
  z
    .object({ itemId: id, adjustmentId: id, kind: z.literal("consume") })
    .strict(),
  z
    .object({ itemId: id, adjustmentId: id, kind: z.literal("discard") })
    .strict(),
  z.object({ itemId: id, adjustmentId: id, kind: z.literal("undo") }).strict(),
  z.object({ itemId: id, kind: z.literal("edit") }).strict(),
  z.object({ itemId: id, kind: z.literal("remove") }).strict(),
]);
export type InventoryChangeInput = z.infer<typeof inventoryChangeInput>;
export type InventoryChangeOperation = z.infer<typeof inventoryChangeOperation>;
export type InventoryChangeReceipt = z.infer<typeof inventoryChangeReceipt>;
