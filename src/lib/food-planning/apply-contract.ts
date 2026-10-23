/** Browser-safe reviewed command and minimal receipt. Never write authority. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { mealCreateInput } from "../meal-create-contract";
import { createMealPrepSchema } from "../meal-batches";
import { foodPreviewRequest } from "./contract";
export const FOOD_APPLY_ACTION = "food-plan.apply.v1";
const groceries = z
  .object({
    key: id,
    // Deliberately explicit. No default "all ingredients" and no inferred list.
    listId: id,
    ingredientIds: z
      .array(id)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
const common = {
  sourceRequest: foodPreviewRequest,
  protocol: z.literal("herewoven.food-apply.v1"),
  reviewProof: z.string().min(1).max(8192),
  groceries: z.array(groceries).max(14),
};
export const reviewedFoodWrite = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...common,
        mode: z.literal("meals"),
        meals: z
          .array(z.object({ key: id, input: mealCreateInput }).strict())
          .min(1)
          .max(14),
      })
      .strict(),
    z
      .object({
        ...common,
        mode: z.literal("prep"),
        dishKeys: z.array(id).min(1).max(8),
        input: createMealPrepSchema,
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    const keys =
      value.mode === "meals"
        ? value.meals.map((row) => row.key)
        : value.dishKeys;
    if (
      value.sourceRequest.plan.mode !== value.mode ||
      keys.length !== value.sourceRequest.plan.slots.length ||
      keys.some(
        (key) =>
          !value.sourceRequest.plan.slots.some((slot) => slot.key === key),
      ) ||
      new Set(keys).size !== keys.length ||
      (value.mode === "prep" && keys.length !== value.input.dishes.length) ||
      new Set(value.groceries.map((row) => row.key)).size !==
        value.groceries.length ||
      value.groceries.some((row) => !keys.includes(row.key))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Review each unique meal or dish and its grocery selection.",
      });
    // This path creates recipe-linked proposals only. Manual/free-text meals and
    // bulk dishes retain their existing canonical editors and are not invented.
    if (
      value.mode === "meals"
        ? value.meals.some((row) => !row.input.recipe_id)
        : value.input.dishes.some((row) => !row.recipe_id)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Review a canonical recipe for every choice.",
      });
  });
export type ReviewedFoodWrite = z.infer<typeof reviewedFoodWrite>;
export const foodApplyReceipt = z
  .object({
    meals: z.array(z.object({ key: id, mealId: id }).strict()).max(14),
    prep: z
      .object({
        sessionId: id,
        dishes: z.array(z.object({ key: id, batchId: id }).strict()).max(8),
      })
      .strict()
      .nullable(),
    groceries: z
      .array(z.object({ key: id, requestId: id, listId: id }).strict())
      .max(14),
  })
  .strict();
export type FoodApplyReceipt = z.infer<typeof foodApplyReceipt>;
/** Pointer proof must correspond to this frozen command, not merely parse. */
export function foodApplyReceiptMatches(
  raw: unknown,
  command: ReviewedFoodWrite,
): boolean {
  const parsed = foodApplyReceipt.safeParse(raw);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  const sameKeys = (
    actual: readonly { key: string }[],
    expected: readonly string[],
  ) =>
    actual.length === expected.length &&
    new Set(actual.map((row) => row.key)).size === actual.length &&
    actual.every((row) => expected.includes(row.key));
  if (command.mode === "meals") {
    if (
      receipt.prep !== null ||
      !sameKeys(
        receipt.meals,
        command.meals.map((row) => row.key),
      ) ||
      new Set(receipt.meals.map((row) => row.mealId)).size !==
        receipt.meals.length
    )
      return false;
  } else if (
    receipt.meals.length ||
    !receipt.prep ||
    !sameKeys(receipt.prep.dishes, command.dishKeys) ||
    new Set(receipt.prep.dishes.map((row) => row.batchId)).size !==
      receipt.prep.dishes.length
  )
    return false;
  return (
    sameKeys(
      receipt.groceries,
      command.groceries.map((row) => row.key),
    ) &&
    new Set(receipt.groceries.map((row) => row.requestId)).size ===
      receipt.groceries.length &&
    receipt.groceries.every((row) =>
      command.groceries.some(
        (selection) =>
          selection.key === row.key && selection.listId === row.listId,
      ),
    )
  );
}
