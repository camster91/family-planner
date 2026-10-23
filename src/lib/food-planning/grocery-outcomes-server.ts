/** Read original child outcomes, or undo exactly one linked canonical grocery add.
 * Neither operation repeats a food save or requires a still-fresh planning lease. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashIdempotentRequest } from "../idempotency";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import {
  ADD_FROM_RECIPE_ACTION,
  UNDO_WINDOW_MS,
  addFromRecipeSchema,
  undoRecipeAdd,
} from "../grocery-from-recipe";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
} from "./apply-contract";
import { authorizeFoodWriteInTx, FoodWriteRefused } from "./persist";
import { readFoodReviewSeal } from "./review-proof";
import type { FoodPlanActor } from "./server";
import type { FoodRecoveryEntry } from "./recovery-contract";
import {
  FOOD_GROCERY_OUTCOMES,
  canonicalGroceryResult,
  foodGroceryOutcomesReply,
  foodGroceryUndoReply,
} from "./grocery-outcomes-contract";
function unavailable(): never {
  throw new FoodWriteRefused({
    status: 409,
    body: { error: { code: "GROCERY_DETAILS_UNAVAILABLE" } },
  });
}
async function original(
  tx: Prisma.TransactionClient,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
) {
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  await authorizeFoodWriteInTx(tx, actor, command);
  readFoodReviewSeal(actor, command);
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), "lists"))
    unavailable();
  const requestHash = hashIdempotentRequest(FOOD_APPLY_ACTION, command);
  const record = await tx.idempotencyRecord.findFirst({
    where: {
      scope: `user:${actor.userId}`,
      key: entry.key,
      user_id: actor.userId,
      family_id: actor.familyId,
      action: FOOD_APPLY_ACTION,
      request_hash: requestHash,
    },
    select: { response_status: true, response_body: true },
  });
  if (
    !record ||
    record.response_status !== 201 ||
    !foodApplyReceiptMatches(record.response_body, command)
  )
    unavailable();
  return {
    command,
    receipt: foodApplyReceipt.parse(record.response_body),
    requestHash,
  };
}
type Original = Awaited<ReturnType<typeof original>>;
async function child(
  tx: Prisma.TransactionClient,
  actor: FoodPlanActor,
  source: Original,
  pointer: Original["receipt"]["groceries"][number],
) {
  const selection = source.command.groceries.find(
    (row) => row.key === pointer.key,
  )!;
  const command = source.command;
  const target =
    command.mode === "meals"
      ? (() => {
          const meal = command.meals.find(
            (row) => row.key === pointer.key,
          )!.input;
          return {
            recipeId: meal.recipe_id!,
            mealId: source.receipt.meals.find((row) => row.key === pointer.key)!
              .mealId,
            servings: meal.servings ?? undefined,
          };
        })()
      : (() => {
          const dish =
            command.input.dishes[command.dishKeys.indexOf(pointer.key)];
          return {
            recipeId: dish.recipe_id!,
            batchId: source.receipt.prep!.dishes.find(
              (row) => row.key === pointer.key,
            )!.batchId,
            servings: dish.total_servings,
          };
        })();
  const input = addFromRecipeSchema.parse({
    ...target,
    listId: selection.listId,
    ingredientIds: selection.ingredientIds,
  });
  const record = await tx.idempotencyRecord.findFirst({
    where: {
      id: pointer.requestId,
      scope: `user:${actor.userId}`,
      user_id: actor.userId,
      family_id: actor.familyId,
      action: ADD_FROM_RECIPE_ACTION,
      request_hash: hashIdempotentRequest(ADD_FROM_RECIPE_ACTION, input),
    },
    select: { response_status: true, response_body: true, created_at: true },
  });
  if (!record || record.response_status !== 201) return null;
  const parsed = canonicalGroceryResult.safeParse(record.response_body);
  if (!parsed.success) return null;
  const result = parsed.data;
  return result.requestId === pointer.requestId &&
    result.listId === pointer.listId &&
    result.createdCount + result.alreadyOnListCount ===
      selection.ingredientIds.length &&
    Date.parse(result.undoExpiresAt) === +record.created_at + UNDO_WINDOW_MS &&
    result.possibleDuplicates.every((row) =>
      selection.ingredientIds.includes(row.ingredientId),
    )
    ? result
    : null;
}
export function readFoodGroceryOutcomes(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  ownerScope: string,
) {
  return db.$transaction(
    async (tx) => {
      const source = await original(tx, actor, entry);
      const outcomes = [];
      for (const pointer of source.receipt.groceries)
        outcomes.push({
          ...pointer,
          result: await child(tx, actor, source, pointer),
        });
      return foodGroceryOutcomesReply.parse({
        protocol: FOOD_GROCERY_OUTCOMES,
        ownerScope,
        requestHash: source.requestHash,
        outcomes,
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
export function undoFoodGroceryAdd(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  requestId: string,
  ownerScope: string,
) {
  return db.$transaction(
    async (tx) => {
      const source = await original(tx, actor, entry);
      const pointer = source.receipt.groceries.find(
        (row) => row.requestId === requestId,
      );
      if (!pointer || !(await child(tx, actor, source, pointer))) unavailable();
      const undone = await undoRecipeAdd(tx, requestId, {
        id: actor.userId,
        family_id: actor.familyId,
        tokenVersion: actor.generation,
      });
      const result =
        "error" in undone.body
          ? { kind: "refused", code: undone.body.error.code }
          : {
              kind: "done",
              removedCount: undone.body.removedCount,
              keptCheckedCount: undone.body.keptCheckedCount,
            };
      return foodGroceryUndoReply.parse({
        protocol: FOOD_GROCERY_OUTCOMES,
        ownerScope,
        requestHash: source.requestHash,
        requestId,
        result,
      });
    },
    { isolationLevel: "Serializable", timeout: 15000 },
  );
}
