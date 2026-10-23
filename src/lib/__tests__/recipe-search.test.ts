import { recipeSearchSchema, recipeSearchWhere } from "@/lib/recipe-search";
import { createRecipeSchema } from "@/lib/recipes";
test("saved search keeps every filter under the same household", () => {
  const where = recipeSearchWhere(
    "fx_household",
    recipeSearchSchema.parse({
      q: "soup",
      ingredient: "onion",
      maxPrep: "20",
      minServings: "4",
    }),
  );
  expect(where).toEqual(
    expect.objectContaining({
      family_id: "fx_household",
      prep_time: { lte: 20 },
      servings: { gte: 4 },
    }),
  );
  expect((where.ingredients as any).some.ingredient.family_id).toBe(
    "fx_household",
  );
});
test.each([
  { maxPrep: "unknown" },
  { minServings: "101" },
  { q: "x".repeat(121) },
])("invalid filters fail before querying: %j", (filters) => {
  expect(recipeSearchSchema.safeParse(filters).success).toBe(false);
});
test("unknown create protocols fail rather than creating a guessed recipe", () => {
  expect(
    createRecipeSchema.safeParse({
      title: "Fixture soup",
      creation_protocol: "future.v2",
    }).success,
  ).toBe(false);
});
