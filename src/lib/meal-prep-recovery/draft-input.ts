/** Exact canonical conversion shared by the editor and durable promotion guard. */
import { createMealPrepSchema, mealPrepActionSchema } from "../meal-batches";
import { prepDraft, type PrepDraft } from "./draft-contract";
import type { PrepContext } from "./contract";
export function prepDraftInput(raw: PrepDraft, context: PrepContext) {
  const draft = prepDraft.parse(raw),
    identity = {
      expected_user_id: context.userId,
      expected_family_id: context.familyId,
    };
  if (draft.kind === "create")
    return createMealPrepSchema.parse({
      ...identity,
      prepared_on: draft.day,
      next_prep_on: draft.nextDay || null,
      dishes: draft.dishes.map((dish) => ({
        name: dish.name,
        total_servings: Number(dish.portions),
        recipe_id: dish.recipe?.id ?? null,
        cook_id: dish.cookId || null,
        reserve_storage: dish.storage,
        meals: dish.meals.map((meal) => ({
          ...meal,
          servings: Number(meal.servings),
        })),
      })),
    });
  return mealPrepActionSchema.parse({
    ...identity,
    action: draft.action,
    ...(draft.action === "allocate"
      ? {
          batch_id: draft.batchId,
          meals: draft.meals.map((meal) => ({
            ...meal,
            servings: Number(meal.servings),
          })),
          ...(draft.requirePrepared ? { require_prepared: true } : {}),
        }
      : draft.action === "eaten"
        ? {
            batch_id: draft.batchId,
            meal_id: draft.mealId || null,
            servings: Number(draft.servings),
          }
        : draft.action === "undo-eaten"
          ? { consumption_id: draft.consumptionId }
          : draft.action === "next-prep"
            ? {
                session_id: draft.sessionId,
                next_prep_on: draft.nextDay || null,
                expected_next_prep_on: draft.expectedNext,
              }
            : { session_id: draft.sessionId }),
  });
}
