/** Versioned fabricated evaluation fixture. Never app/provider data. */
import { FOOD_AI } from "../ai-contract";
import { buildFoodPlan } from "../planner";
import { foodPreviewRequest, type FoodPlanningInputs } from "../contract";
import { makePreview } from "./view-fixture";
export const FOOD_AI_FIXTURE_VERSION = "food-ai-fixtures.2026-10-22.v1";
export function aiFixture() {
  const view = makePreview();
  const sourceRequest = foodPreviewRequest.parse({
    ...view.sourceRequest,
    plan: {
      ...view.sourceRequest.plan,
      slots: view.sourceRequest.plan.slots.map((row) => ({
        ...row,
        recipeId: undefined,
      })),
    },
  });
  const inputs: FoodPlanningInputs = {
    recipes: ["a", "b"].map((letter) => ({
      id: `recipe-${letter}`,
      title: `Synthetic ${letter}`,
      servings: 2,
      prep_time: 5,
      cook_time: 15,
      ingredients: [
        {
          amount: 100,
          unit: "g",
          ingredient: { id: "ingredient-a", name: "Synthetic rice", unit: "g" },
        },
      ],
    })),
    stock: [],
    occupied: [],
    coverage: { recipes: true, stock: true, meals: true },
  };
  const original = {
    ...view,
    sourceRequest,
    plan: buildFoodPlan(sourceRequest.plan, inputs),
  };
  const query = foodPreviewRequest.parse({
    ...sourceRequest,
    plan: {
      ...sourceRequest.plan,
      slots: sourceRequest.plan.slots.map((row) => ({
        ...row,
        recipeId: "recipe-b",
      })),
    },
  });
  const proposal = {
    ...original,
    sourceRequest: query,
    plan: buildFoodPlan(query.plan, inputs),
  };
  return { original, proposal, inputs };
}
export function issuedReply(
  catalog: import("../ai-catalog").FoodAiCatalog,
  recipe = "recipe-b",
) {
  return {
    protocol: FOOD_AI,
    choices: catalog.mapping.map((row) => ({
      slot: row.ref,
      recipe: row.choices.find(
        (choice) => choice.candidate.recipeId === recipe,
      )!.ref,
    })),
  };
}
