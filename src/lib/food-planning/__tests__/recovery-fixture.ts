/** Fabricated source fixtures only. Never imported by app/runtime code. */
import { reviewedFoodWrite, foodApplyReceipt } from "../apply-contract";
import {
  FOOD_RECOVERY,
  foodRecoveryContext,
  foodRecoveryEntry,
} from "../recovery-contract";
export const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent" as const,
  generation: 0,
};
export const now = new Date("2026-10-22T12:00:00Z");
export function makeCommand() {
  return reviewedFoodWrite.parse({
    protocol: "herewoven.food-apply.v1",
    mode: "meals",
    reviewProof: "fixture-placeholder",
    sourceRequest: {
      plan: {
        timeZone: "UTC",
        slots: [
          {
            key: "dinner",
            date: "2026-10-22",
            mealType: "dinner",
            servings: 2,
            recipeId: "recipe-a",
          },
        ],
      },
    },
    meals: [
      {
        key: "dinner",
        input: {
          protocol: "herewoven.meal-create.v1",
          expected_user_id: actor.userId,
          expected_family_id: actor.familyId,
          issued_at: now.toISOString(),
          date: "2026-10-22",
          meal_type: "dinner",
          recipe_id: "recipe-a",
          servings: 2,
        },
      },
    ],
    groceries: [],
  });
}
export const context = () =>
  foodRecoveryContext.parse({
    contract: FOOD_RECOVERY,
    enabled: true,
    userId: actor.userId,
    familyId: actor.familyId,
    role: actor.role,
    owner: {
      kind: "person",
      ownerId: actor.userId,
      generation: 0,
      householdScope: "c".repeat(64),
      scope: "b".repeat(64),
    },
  });
export const makeEntry = (command = makeCommand()) =>
  foodRecoveryEntry.parse({
    kind: "food-plan",
    key: "food_request_123456789",
    body: JSON.stringify(command),
  });
export const receipt = () =>
  foodApplyReceipt.parse({
    meals: [{ key: "dinner", mealId: "meal-a" }],
    prep: null,
    groceries: [],
  });
