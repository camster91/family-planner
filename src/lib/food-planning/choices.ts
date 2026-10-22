/** Pure semantic matching shared by server review and browser validation. */
import type { FoodPlanActor } from "./server";
import type { ReviewedFoodWrite } from "./apply-contract";
import type { FoodPlan } from "./contract";
export function foodWriteChoicesMatch(
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
    return false;
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
      return false;
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
        return false;
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
      return false;
  }
  for (const selection of input.groceries) {
    const choice = choices.get(selection.key);
    if (
      !choice ||
      selection.ingredientIds.some(
        (id) => !choice.ingredients.some((line) => line.ingredientId === id),
      )
    )
      return false;
  }
  return true;
}
