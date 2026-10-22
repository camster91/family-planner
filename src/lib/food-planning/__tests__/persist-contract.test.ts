/** Authored for consolidated QA; no effects or providers. */
import { reviewedFoodWrite } from "../apply-contract";
const meal = (key: string) => ({
  key,
  input: {
    protocol: "herewoven.meal-create.v1",
    expected_user_id: "fixture-person",
    expected_family_id: "fixture-family",
    issued_at: "2026-10-22T12:00:00Z",
    date: "2026-10-23",
    meal_type: "dinner",
    recipe_id: "fixture-recipe",
    servings: 4,
  },
});
const sourceRequest = {
  plan: {
    timeZone: "UTC",
    slots: [
      {
        key: "first",
        date: "2026-10-23",
        mealType: "dinner",
        servings: 4,
        recipeId: "fixture-recipe",
      },
    ],
  },
};
const base = () => ({
  sourceRequest,
  protocol: "herewoven.food-apply.v1",
  mode: "meals",
  reviewProof: "fixture-proof",
  meals: [meal("first")],
  groceries: [],
});
describe("reviewed food write shape", () => {
  it("requires explicit unique ingredient selections and list for every requested grocery add", () => {
    const value = {
      ...base(),
      groceries: [
        {
          key: "first",
          listId: "fixture-list",
          ingredientIds: ["fixture-ingredient"],
        },
      ],
    };
    expect(reviewedFoodWrite.safeParse(value).success).toBe(true);
    for (const groceries of [
      [{ key: "first", ingredientIds: ["fixture-ingredient"] }],
      [{ key: "first", listId: "fixture-list", ingredientIds: [] }],
      [{ key: "first", listId: "fixture-list", ingredientIds: ["a", "a"] }],
      [{ key: "absent", listId: "fixture-list", ingredientIds: ["a"] }],
      [value.groceries[0], value.groceries[0]],
    ])
      expect(
        reviewedFoodWrite.safeParse({ ...base(), groceries }).success,
      ).toBe(false);
  });
  it("refuses duplicate choice keys, unlinked/free-text proposals and unknown instructions", () => {
    expect(
      reviewedFoodWrite.safeParse({
        ...base(),
        meals: [meal("first"), meal("first")],
      }).success,
    ).toBe(false);
    expect(
      reviewedFoodWrite.safeParse({
        ...base(),
        meals: [
          {
            ...meal("first"),
            input: { ...meal("first").input, recipe_id: null },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewedFoodWrite.safeParse({ ...base(), purchase: true }).success,
    ).toBe(false);
  });
  it("keeps canonical prep limits, portions and next-prep constraints", () => {
    const value = {
      sourceRequest: { plan: { ...sourceRequest.plan, mode: "prep" } },
      protocol: "herewoven.food-apply.v1",
      mode: "prep",
      reviewProof: "fixture-proof",
      groceries: [],
      dishKeys: ["first"],
      input: {
        expected_user_id: "fixture-person",
        expected_family_id: "fixture-family",
        prepared_on: "2026-10-23",
        next_prep_on: "2026-10-30",
        dishes: [
          {
            name: "Fixture dish",
            total_servings: 4,
            reserve_storage: "fridge",
            recipe_id: "fixture-recipe",
            meals: [],
          },
        ],
      },
    };
    expect(reviewedFoodWrite.safeParse(value).success).toBe(true);
    expect(
      reviewedFoodWrite.safeParse({ ...value, dishKeys: ["first", "second"] })
        .success,
    ).toBe(false);
    expect(
      reviewedFoodWrite.safeParse({
        ...value,
        input: { ...value.input, next_prep_on: "2026-10-22" },
      }).success,
    ).toBe(false);
    expect(
      reviewedFoodWrite.safeParse({
        ...value,
        input: {
          ...value.input,
          dishes: [{ ...value.input.dishes[0], total_servings: 51 }],
        },
      }).success,
    ).toBe(false);
  });
});
