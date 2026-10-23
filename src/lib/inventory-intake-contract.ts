import { z } from "zod";
import { foodProductDraft } from "@/lib/food-product-contract";
import { createInventorySchema } from "@/lib/inventory";
const id = z.string().min(1).max(128);
export const inventoryIntakeContext = z
  .object({ userId: id, familyId: id })
  .strict();
export const inventoryIntakeInput = z
  .object({
    protocol: z.literal("herewoven.inventory-intake.v1"),
    expected_user_id: id,
    expected_family_id: id,
    issued_at: z.string().datetime(),
    item: createInventorySchema,
    product: foodProductDraft.optional(),
    label: z
      .object({ package_size: z.string().trim().max(80).nullable() })
      .strict()
      .optional(),
  })
  .strict();
export const inventoryIntakeReceipt = z.object({ itemId: id }).strict();
export type InventoryIntakeInput = z.infer<typeof inventoryIntakeInput>;
