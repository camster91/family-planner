/** Fabricated read DTO fixture, never app data. */
import { buildFoodPlan } from "../planner";
import { actor, now, makeCommand } from "./recovery-fixture";
export function makePreview() {
  const sourceRequest = makeCommand().sourceRequest;
  const plan = buildFoodPlan(sourceRequest.plan, {
    recipes: [
      {
        id: "recipe-a",
        title: "Synthetic rice",
        servings: 2,
        prep_time: 5,
        cook_time: 15,
        ingredients: [
          {
            amount: 100,
            unit: "g",
            ingredient: { id: "ingredient-a", name: "Rice", unit: "g" },
          },
        ],
      },
    ],
    stock: [],
    occupied: [],
    coverage: { recipes: true, stock: true, meals: true },
  });
  return {
    owner: actor,
    sourceRequest,
    generatedAt: now.toISOString(),
    expiresAt: new Date(+now + 60000).toISOString(),
    recipeScope: "library" as const,
    snapshotRevision: "a".repeat(64),
    plan,
  };
}
export function makeReview() {
  const { owner, generatedAt, expiresAt, plan } = makePreview();
  return {
    owner,
    generatedAt,
    expiresAt,
    plan,
    input: makeCommand(),
    people: [],
    lists: [],
    groceries: [],
  };
}
