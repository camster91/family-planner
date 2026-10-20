import {
  importedRecipeInstructions,
  onlineRecipeSchema,
  recipeImportIssues,
} from "../recipe-preview-contract";
const recipe = {
  title: "Fixture soup",
  description: "",
  source: "https://example.test/soup",
  ingredientLines: ["Beans to taste"],
  instructions: "Stir.",
  servings: null,
  prep_time: null,
  cook_time: null,
};
it("keeps missing serving/time data unknown and flags it for review", () => {
  const parsed = onlineRecipeSchema.parse(recipe);
  expect(recipeImportIssues(parsed)).toEqual(
    expect.arrayContaining([
      "servings-unknown",
      "prep-time-unknown",
      "cook-time-unknown",
    ]),
  );
  expect(
    onlineRecipeSchema.parse({ ...recipe, servings: undefined }).servings,
  ).toBeNull();
});
it("retains all bounded extracted text even when the combined save draft is too long", () => {
  const long = onlineRecipeSchema.parse({
    ...recipe,
    ingredientLines: Array.from(
      { length: 100 },
      (_, index) => `${index} ${"a".repeat(490)}`,
    ),
    instructions: "last original direction",
  });
  const draft = importedRecipeInstructions(long);
  expect(draft.length).toBeGreaterThan(20000);
  expect(draft).toContain(long.ingredientLines[99]);
  expect(draft.endsWith("last original direction")).toBe(true);
});
it.each([
  { source: "javascript:alert(1)" },
  { source: "https://user:password@example.test/recipe" },
  { servings: 2.5 },
  { reviewIssues: ["future-format"] },
  { provider_context: "untrusted" },
])("refuses unknown or unsafe preview metadata %j", (change) => {
  expect(onlineRecipeSchema.safeParse({ ...recipe, ...change }).success).toBe(
    false,
  );
});
