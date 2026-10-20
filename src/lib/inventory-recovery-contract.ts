/** Exact pending online requests, never an offline stock-mutation queue. */
import { z } from "zod";
import { inventoryIntakeInput } from "@/lib/inventory-intake-contract";
import { inventoryChangeInput } from "@/lib/inventory-change-contract";
import { restockInput } from "@/lib/inventory-restock-contract";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";

export const INVENTORY_RECOVERY_CONTRACT = "herewoven.inventory-recovery.v1";
export const INVENTORY_RECOVERY_OWNER_HEADER = "X-Herewoven-Inventory-Owner";
export const INVENTORY_RECOVERY_MAX_ROWS = 20;
export const INVENTORY_RECOVERY_MAX_BYTES = 200 * 1024;
const personOwner = queueOwnerSchema.refine((owner) => owner.kind === "person");
export const inventoryRecoveryContext = z
  .object({
    contract: z.literal(INVENTORY_RECOVERY_CONTRACT),
    enabled: z.boolean(),
    owner: personOwner.nullable(),
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type InventoryRecoveryContext = z.infer<typeof inventoryRecoveryContext>;
export const inventoryRecoveryEntry = z
  .object({
    kind: z.enum(["intake", "change", "restock"]),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z.string().min(1).max(8192),
  })
  .strict()
  .superRefine((entry, ctx) => {
    try {
      const parsed: unknown = JSON.parse(entry.body);
      const result =
        entry.kind === "intake"
          ? inventoryIntakeInput.safeParse(parsed)
          : entry.kind === "restock"
            ? restockInput.safeParse(parsed)
            : inventoryChangeInput.safeParse(parsed);
      if (!result.success || new Blob([entry.body]).size > 8192)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid inventory intent",
        });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid inventory intent",
      });
    }
  });
export type InventoryRecoveryEntry = z.infer<typeof inventoryRecoveryEntry>;
export const inventoryRecoveryJournal = z
  .object({
    contract: z.literal(INVENTORY_RECOVERY_CONTRACT),
    entries: z.array(inventoryRecoveryEntry).max(INVENTORY_RECOVERY_MAX_ROWS),
  })
  .strict()
  .refine(
    (journal) =>
      new Set(journal.entries.map((row) => row.key)).size ===
      journal.entries.length,
  );

/** Parsed values validate ownership only; callers retain the original body bytes. */
export function inventoryEntryMatchesContext(
  entry: InventoryRecoveryEntry,
  context: InventoryRecoveryContext,
) {
  const input = JSON.parse(entry.body) as {
    expected_user_id: string;
    expected_family_id: string;
  };
  return (
    input.expected_user_id === context.userId &&
    input.expected_family_id === context.familyId
  );
}
