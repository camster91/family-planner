/** Browser-safe exact-request recovery. No background dispatch or new-key retry. */
import { z } from "zod";
import { queueOwnerSchema } from "../queue-owner-contract";
import {
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
} from "./apply-contract";
export const FOOD_RECOVERY = "herewoven.food-recovery.v1";
export const FOOD_OWNER_HEADER = "X-Herewoven-Food-Owner";
export const FOOD_BODY_MAX_BYTES = 65536;
export const foodRecoveryKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const foodRecoveryContext = z
  .object({
    contract: z.literal(FOOD_RECOVERY),
    enabled: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
    role: z.enum(["parent", "teen"]),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type FoodRecoveryContext = z.infer<typeof foodRecoveryContext>;
export const foodRecoveryEntry = z
  .object({
    kind: z.literal("food-plan"),
    key: foodRecoveryKey,
    body: z.string().min(1).max(FOOD_BODY_MAX_BYTES),
  })
  .strict()
  .refine((entry) => {
    try {
      return (
        new TextEncoder().encode(entry.body).byteLength <=
          FOOD_BODY_MAX_BYTES &&
        reviewedFoodWrite.safeParse(JSON.parse(entry.body)).success
      );
    } catch {
      return false;
    }
  });
export type FoodRecoveryEntry = z.infer<typeof foodRecoveryEntry>;
export const foodRecoveryJournal = z
  .object({
    contract: z.literal(FOOD_RECOVERY),
    entries: z.array(foodRecoveryEntry).max(4),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((row) => row.key)).size ===
      value.entries.length,
  );
export const foodRecoveryInput = z
  .object({ contract: z.literal(FOOD_RECOVERY), entry: foodRecoveryEntry })
  .strict();
export function foodEntryMatchesContext(
  entry: FoodRecoveryEntry,
  context: FoodRecoveryContext,
) {
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  const contexts =
    command.mode === "meals"
      ? command.meals.map((row) => row.input)
      : [command.input];
  return contexts.every(
    (value) =>
      value.expected_user_id === context.userId &&
      value.expected_family_id === context.familyId,
  );
}
export const foodRecoveryReply = z
  .object({
    contract: z.literal(FOOD_RECOVERY),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    entry: foodRecoveryEntry,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      "ready",
      "pending",
      "committed",
      "expired",
      "conflict",
      "paused",
      "unavailable",
    ]),
    canRetry: z.boolean(),
    retryUntil: z.string().datetime().nullable(),
    receipt: foodApplyReceipt.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let command: ReturnType<typeof reviewedFoodWrite.parse>;
    try {
      command = reviewedFoodWrite.parse(JSON.parse(value.entry.body));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid saved food request",
      });
      return;
    }
    if (
      value.canRetry !== (value.state === "ready") ||
      (value.retryUntil !== null) !== value.canRetry ||
      (value.receipt !== null) !== (value.state === "committed") ||
      (value.receipt && !foodApplyReceiptMatches(value.receipt, command))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent food recovery proof",
      });
  });
export type FoodRecoveryReply = z.infer<typeof foodRecoveryReply>;
