import { z } from "zod";
const id = z.string().min(1).max(128);
export const INVENTORY_RESTOCK_ACTION = "grocery.add-from-inventory.v1";
export const restockInput = z
  .object({
    protocol: z.literal("herewoven.inventory-restock.v1"),
    expected_user_id: id,
    expected_family_id: id,
    issued_at: z.string().datetime(),
    item_id: id,
    expected_version: z.string().datetime(),
    list_id: id,
    content: z.string().trim().min(1).max(200),
    amount: z.number().finite().gt(0).max(100000),
    unit: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .transform((value) => value || null),
    allow_similar: z.boolean(),
  })
  .strict();
export type RestockInput = z.infer<typeof restockInput>;
export const restockReceipt = z
  .object({
    itemId: id,
    listId: id,
    requestId: id,
    created: z.boolean(),
    undoExpiresAt: z.string().datetime(),
  })
  .strict();
export const restockReview = z
  .object({
    userId: id,
    familyId: id,
    item: z
      .object({
        id,
        name: z.string().min(1).max(200),
        version: z.string().datetime(),
      })
      .strict(),
    lists: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            type: z.enum(["grocery", "shopping"]),
          })
          .strict(),
      )
      .max(100),
    listsTruncated: z.boolean(),
    selectedListId: id.nullable(),
    existingSourceItemId: id.nullable(),
    similar: z
      .array(z.object({ id, content: z.string().min(1).max(500) }).strict())
      .max(10),
    comparisonIncomplete: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.lists.map((list) => list.id)).size === value.lists.length &&
      new Set(value.similar.map((item) => item.id)).size ===
        value.similar.length &&
      (value.selectedListId === null
        ? value.existingSourceItemId === null && value.similar.length === 0
        : value.lists.some((list) => list.id === value.selectedListId)),
  );
