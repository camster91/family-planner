/** Authored for consolidated QA; no provider or database required. */
import { mealRecipeSnapshot } from "../meal-recipe-history-contract";
const record = {
  v: 1,
  recipe: {
    id: "recipe",
    title: "Soup",
    description: null,
    instructions: "Simmer",
    source_url: null,
    revision: 2,
    servings: 4,
    prep_time: null,
    cook_time: 30,
    ingredients: [],
  },
};
describe("prep recipe evidence reader", () => {
  it("keeps recorded quantities and authored text without inferred fields", () => {
    expect(mealRecipeSnapshot.parse(record)).toEqual(record);
  });
  it("refuses future versions and unknown metadata instead of discarding it", () => {
    expect(mealRecipeSnapshot.safeParse({ ...record, v: 2 }).success).toBe(
      false,
    );
    expect(
      mealRecipeSnapshot.safeParse({ ...record, model_context: "private" })
        .success,
    ).toBe(false);
    expect(
      mealRecipeSnapshot.safeParse({
        ...record,
        recipe: { ...record.recipe, creator_email: "private@example.invalid" },
      }).success,
    ).toBe(false);
  });
  it("refuses incomplete evidence rather than filling from the current recipe", () => {
    const { revision, ...incomplete } = record.recipe;
    expect(
      mealRecipeSnapshot.safeParse({ ...record, recipe: incomplete }).success,
    ).toBe(false);
    expect(
      mealRecipeSnapshot.safeParse({
        ...record,
        recipe: { ...record.recipe, servings: 0 },
      }).success,
    ).toBe(false);
  });
});
