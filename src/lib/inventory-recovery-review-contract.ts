/** Private read-only review of one exact saved request; never write permission. */
import { z } from "zod";
import { inventoryRecoveryEntry } from "@/lib/inventory-recovery-contract";
import { inventoryIntakeReceipt } from "@/lib/inventory-intake-contract";
import {
  inventoryChangeInput,
  inventoryChangeReceipt,
} from "@/lib/inventory-change-contract";
export const INVENTORY_RECOVERY_REVIEW_CONTRACT =
  "herewoven.inventory-recovery-review.v1";
export const inventoryRecoveryReviewInput = z
  .object({
    contract: z.literal(INVENTORY_RECOVERY_REVIEW_CONTRACT),
    entry: inventoryRecoveryEntry,
  })
  .strict();
export const inventoryRecoveryReview = z
  .object({
    contract: z.literal(INVENTORY_RECOVERY_REVIEW_CONTRACT),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: inventoryRecoveryEntry,
    state: z.enum([
      "ready",
      "pending",
      "committed",
      "removed",
      "expired",
      "conflict",
      "unavailable",
    ]),
    canRetry: z.boolean(),
    name: z.string().min(1).max(200).nullable(),
    current: z
      .object({
        amount: z.number().finite().min(0).max(100000).nullable(),
        unit: z.string().max(32).nullable(),
        location: z.enum(["fridge", "freezer", "pantry"]),
        status: z.enum(["active", "consumed", "discarded"]),
        updatedAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    receipt: z
      .union([inventoryIntakeReceipt, inventoryChangeReceipt])
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.canRetry !== (value.state === "ready") ||
      ((value.state === "committed" || value.state === "removed") &&
        !value.receipt) ||
      (value.state !== "committed" &&
        value.state !== "removed" &&
        value.receipt)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contradictory inventory review",
      });
    if (value.receipt) {
      let valid = false;
      if (value.entry.kind === "intake") valid = !("kind" in value.receipt);
      else {
        try {
          const parsed = inventoryChangeInput.safeParse(
            JSON.parse(value.entry.body),
          );
          if (parsed.success) {
            const operation = parsed.data.operation;
            valid =
              "kind" in value.receipt &&
              value.receipt.kind === operation.kind &&
              (operation.kind === "undo"
                ? "adjustmentId" in value.receipt &&
                  value.receipt.adjustmentId === operation.adjustment_id
                : value.receipt.itemId === operation.item_id);
          }
        } catch {
          /* Nested invalid input remains a validation failure. */
        }
      }
      if (!valid)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Inventory receipt differs from original intent",
        });
    }
  });
export type InventoryRecoveryReview = z.infer<typeof inventoryRecoveryReview>;
