import { FOOD_BODY_MAX_BYTES } from "./recovery-contract";
import { foodWritingEnabled } from "./owner";
import { readFoodSourceVersions } from "./source-versions";
/** Concrete read/review + same-transaction source renewal. No provider or
 * autonomous dispatch. Version storage must be applied and verified; the owned
 * confirmation UI must finish before activation. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { reviewedFoodWrite, type ReviewedFoodWrite } from "./apply-contract";
import {
  foodPlanningEnabled,
  previewFoodPlanInTx,
  type FoodPlanActor,
} from "./server";
import type { FoodPlan } from "./contract";
import type { FoodWriteSourceGuard } from "./persist";
import { parseDateOnly } from "../dates";
import { addDaysToKey, dayKeyFor } from "../local-day-key";
import { recipeGroceryAmount } from "../grocery-from-recipe";
import { authorizeMealBatchInTx } from "../meal-batch-api";
import {
  FoodReviewRefused,
  assertFoodReviewLease,
  foodReviewDigest,
  issueFoodReviewSeal,
  readFoodReviewSeal,
  type FoodReviewSeal,
} from "./review-proof";
/** Every new slot/dish must be the concrete choice from this very source query.
 * Removing/reordering/replacing choices requires a fresh explicit preview. */
export function assertFoodWriteChoices(
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
  plan: FoodPlan,
) {
  const request = input.sourceRequest.plan;
  if (
    request.mode !== input.mode ||
    plan.slots.length !== request.slots.length ||
    (input.mode === "meals" ? input.meals.length : input.dishKeys.length) !==
      request.slots.length ||
    plan.slots.some((slot) => !slot.choice || slot.holds.length) ||
    (input.mode === "prep" &&
      (plan.prepTime === "unknown" ||
        plan.prepTime === "over-requested-limit" ||
        (plan.prepSchedule &&
          !["fits", "not-requested"].includes(plan.prepSchedule.state))))
  )
    throw new FoodReviewRefused();
  const choices = new Map(plan.slots.map((row) => [row.key, row.choice!]));
  const authored = new Map(request.slots.map((row) => [row.key, row]));
  const context = (value: {
    expected_family_id: string;
    expected_user_id: string;
  }) =>
    value.expected_family_id === actor.familyId &&
    value.expected_user_id === actor.userId;
  if (input.mode === "meals") {
    if (new Set(input.meals.map((row) => row.key)).size !== authored.size)
      throw new FoodReviewRefused();
    for (const row of input.meals) {
      const slot = authored.get(row.key),
        choice = choices.get(row.key);
      if (
        !slot ||
        !choice ||
        !context(row.input) ||
        row.input.date !== slot.date ||
        row.input.meal_type !== slot.mealType ||
        row.input.recipe_id !== choice.recipeId ||
        row.input.servings !== slot.servings
      )
        throw new FoodReviewRefused();
    }
  } else {
    if (
      !context(input.input) ||
      input.input.prepared_on !== request.slots[0].date ||
      input.dishKeys.some(
        (key, index) =>
          key !== request.slots[index]?.key ||
          input.input.dishes[index].recipe_id !== choices.get(key)?.recipeId ||
          input.input.dishes[index].total_servings !==
            authored.get(key)?.servings,
      )
    )
      throw new FoodReviewRefused();
  }
  for (const selection of input.groceries) {
    const choice = choices.get(selection.key);
    if (
      !choice ||
      selection.ingredientIds.some(
        (id) => !choice.ingredients.some((line) => line.ingredientId === id),
      )
    )
      throw new FoodReviewRefused();
  }
}
async function readAuxiliary(
  tx: Prisma.TransactionClient,
  actor: FoodPlanActor,
  input: ReviewedFoodWrite,
  now: Date,
) {
  const cooks =
    input.mode === "meals"
      ? input.meals.map((row) => row.input.cook_id)
      : input.input.dishes.flatMap((dish) => [
          dish.cook_id,
          ...dish.meals.map((meal) => meal.cook_id),
        ]);
  const cookIds = [
    ...new Set(cooks.filter((id): id is string => Boolean(id))),
  ].sort();
  const people = cookIds.length
    ? await tx.user.findMany({
        where: { id: { in: cookIds }, family_id: actor.familyId },
        orderBy: { id: "asc" },
        select: { id: true, name: true, role: true, token_version: true },
      })
    : [];
  if (people.length !== cookIds.length) throw new FoodReviewRefused();
  const listIds = [...new Set(input.groceries.map((row) => row.listId))].sort();
  const lists = listIds.length
    ? await tx.list.findMany({
        where: {
          id: { in: listIds },
          family_id: actor.familyId,
          type: { in: ["grocery", "shopping"] },
        },
        orderBy: { id: "asc" },
        select: { id: true, name: true, type: true, updated_at: true },
      })
    : [];
  if (lists.length !== listIds.length) throw new FoodReviewRefused();
  const today = dayKeyFor({
    kind: "tz",
    timeZone: input.sourceRequest.plan.timeZone,
  })(now);
  const allocations =
    input.mode === "prep" ? input.input.dishes.flatMap((row) => row.meals) : [];
  if (
    allocations.some(
      (row) => row.date < today || row.date > addDaysToKey(today, 31),
    )
  )
    throw new FoodReviewRefused();
  const occupiedAllocations = allocations.length
    ? await tx.familyMeal.findMany({
        where: {
          family_id: actor.familyId,
          OR: allocations.map((meal) => ({
            date: parseDateOnly(meal.date)!,
            meal_type: meal.meal_type,
          })),
        },
        select: { id: true },
        take: 1,
      })
    : [];
  // Existing meals are never silently overwritten/added alongside a proposed
  // prep allocation. Several newly reviewed dishes may share one meal slot.
  if (occupiedAllocations.length) throw new FoodReviewRefused();
  const selectedRecipeIds = [
    ...new Set(
      input.groceries.map((selection) =>
        input.mode === "meals"
          ? input.meals.find((row) => row.key === selection.key)!.input
              .recipe_id!
          : input.input.dishes[input.dishKeys.indexOf(selection.key)]
              .recipe_id!,
      ),
    ),
  ].sort();
  const recipes = selectedRecipeIds.length
    ? await tx.recipe.findMany({
        where: { family_id: actor.familyId, id: { in: selectedRecipeIds } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          servings: true,
          ingredients: {
            take: 101,
            orderBy: { id: "asc" },
            select: {
              ingredient_id: true,
              amount: true,
              unit: true,
              ingredient: {
                select: { name: true, unit: true, family_id: true },
              },
            },
          },
        },
      })
    : [];
  if (
    recipes.length !== selectedRecipeIds.length ||
    recipes.some(
      (row) =>
        row.ingredients.length > 100 ||
        row.ingredients.some(
          (line) => line.ingredient.family_id !== actor.familyId,
        ),
    )
  )
    throw new FoodReviewRefused();
  const groceries = input.groceries.map((selection) => {
    const chosen =
      input.mode === "meals"
        ? input.meals.find((row) => row.key === selection.key)!.input
        : input.input.dishes[input.dishKeys.indexOf(selection.key)];
    const recipe = recipes.find((row) => row.id === chosen.recipe_id)!;
    const servings =
      "total_servings" in chosen ? chosen.total_servings : chosen.servings!;
    return {
      key: selection.key,
      listId: selection.listId,
      quantityBasis: "full-scaled-recipe" as const,
      ingredients: selection.ingredientIds.map((ingredientId) => {
        const line = recipe.ingredients.find(
          (row) => row.ingredient_id === ingredientId,
        );
        if (
          !line ||
          !Number.isFinite(line.amount) ||
          line.amount < 0 ||
          recipe.servings < 1
        )
          throw new FoodReviewRefused();
        const amount = recipeGroceryAmount(
          line.amount,
          recipe.servings,
          servings,
        );
        if (!Number.isFinite(amount)) throw new FoodReviewRefused();
        return {
          ingredientId,
          name: line.ingredient.name,
          amount,
          unit: line.unit ?? line.ingredient.unit ?? null,
        };
      }),
    };
  });
  const sourceVersions = await readFoodSourceVersions(tx, actor.familyId, {
    User: cookIds,
    List: listIds,
  });
  return { people, lists, groceries, occupiedAllocations, sourceVersions };
}
export async function reviewFoodPlanWrite(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  raw: unknown,
  now = new Date(),
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new FoodReviewRefused();
  const input = reviewedFoodWrite.parse({
    ...raw,
    reviewProof: "pending-server-review",
  });
  return db.$transaction(
    async (tx) => {
      const observation = await previewFoodPlanInTx(
        tx,
        actor,
        input.sourceRequest,
        now,
      );
      assertFoodWriteChoices(actor, input, observation.plan);
      if (
        input.mode === "prep" &&
        (await authorizeMealBatchInTx(tx, {
          userId: actor.userId,
          familyId: actor.familyId,
          tokenVersion: actor.generation,
        }))
      )
        throw new FoodReviewRefused();
      const auxiliary = await readAuxiliary(tx, actor, input, now);
      const reviewProof = issueFoodReviewSeal(
        actor,
        input,
        observation.snapshotRevision,
        auxiliary,
        now,
      );
      assertFoodReviewLease(
        readFoodReviewSeal(actor, { ...input, reviewProof }),
      );
      if (!foodPlanningEnabled()) throw new FoodReviewRefused();
      const sealedInput = { ...input, reviewProof };
      if (
        Buffer.byteLength(JSON.stringify(sealedInput), "utf8") >
        FOOD_BODY_MAX_BYTES
      )
        throw new FoodReviewRefused();
      return {
        owner: { ...actor },
        generatedAt: observation.generatedAt,
        expiresAt: observation.expiresAt,
        input: sealedInput,
        plan: observation.plan,
        people: auxiliary.people.map(({ id, name, role }) => ({
          id,
          name,
          role,
        })),
        lists: auxiliary.lists.map(({ id, name, type }) => ({
          id,
          name,
          type,
        })),
        groceries: auxiliary.groceries,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
/** Decode/expiry is deferred until verify: completed receipt replay must bypass
 * fresh-source checks and still require the adapter's live original authority. */
export function createFoodWriteSourceGuard(): FoodWriteSourceGuard {
  let seal: FoodReviewSeal | null = null;
  const assertCurrent = () => {
    if (!seal || !foodWritingEnabled()) throw new FoodReviewRefused();
    assertFoodReviewLease(seal);
  };
  return {
    assertCurrent,
    async verify(tx, actor, input) {
      seal = null;
      const reviewed = readFoodReviewSeal(actor, input);
      assertFoodReviewLease(reviewed);
      const now = new Date();
      const observation = await previewFoodPlanInTx(
        tx,
        actor,
        input.sourceRequest,
        now,
      );
      assertFoodWriteChoices(actor, input, observation.plan);
      const auxiliary = await readAuxiliary(tx, actor, input, now);
      if (
        observation.snapshotRevision !== reviewed.source ||
        foodReviewDigest("food-review.auxiliary.v1", auxiliary) !==
          reviewed.auxiliary
      )
        throw new FoodReviewRefused();
      seal = reviewed;
      assertCurrent();
    },
  };
}
