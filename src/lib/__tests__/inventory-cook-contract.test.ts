import { rankCookableRecipes } from "../inventory";
import { cookSuggestionsSchema } from "../inventory-cook-contract";
const recipe = {
  id: "fixture-recipe",
  title: "Fixture soup",
  prep_time: null,
  cook_time: null,
  servings: 2,
  ingredients: [
    { ingredient: { id: "beans", name: "Beans" } },
    { ingredient: { id: "tomato", name: "Tomato" } },
  ],
};
const today = new Date("2026-10-19T00:00:00.000Z");
it("excludes zero, invalid and finished stock while retaining explicit link/name provenance", () => {
  const rows = rankCookableRecipes(
    [recipe],
    [
      { name: "Beans", ingredient_id: "beans", amount: 0, expires_on: null },
      {
        name: "Beans",
        ingredient_id: "beans",
        amount: 2,
        status: "consumed",
        expires_on: null,
      },
      { name: "Beans", ingredient_id: "beans", amount: NaN, expires_on: null },
      {
        name: "  tomato ",
        ingredient_id: null,
        amount: null,
        expires_on: null,
      },
    ],
    today,
  );
  expect(rows[0]).toMatchObject({
    have: [{ ingredientId: "tomato", match: "name" }],
    missing: [{ ingredientId: "beans" }],
  });
  const linked = rankCookableRecipes(
    [recipe],
    [
      {
        name: "Different product label",
        ingredient_id: "beans",
        amount: 0.001,
        expires_on: null,
      },
    ],
    today,
  );
  expect(linked[0].have[0].match).toBe("linked");
  // A positive amount is presence only; no quantity sufficiency is asserted.
  expect(
    cookSuggestionsSchema.safeParse({
      suggestions: linked,
      recipesConsidered: 1,
      truncated: false,
      matching: "presence_only",
    }).success,
  ).toBe(true);
});
it("accepts older presence replies but refuses contradictory counts, duplicate ids and future matching claims", () => {
  const rows = rankCookableRecipes(
    [recipe],
    [{ name: "Beans", ingredient_id: "beans", amount: null, expires_on: null }],
    today,
  );
  const legacy = {
    suggestions: rows.map((row) => ({
      ...row,
      have: row.have.map(({ ingredientId, name }) => ({ ingredientId, name })),
    })),
    recipesConsidered: 1,
    truncated: false,
  };
  expect(cookSuggestionsSchema.safeParse(legacy).success).toBe(true);
  expect(
    cookSuggestionsSchema.safeParse({
      ...legacy,
      matching: "quantities_sufficient",
    }).success,
  ).toBe(false);
  expect(
    cookSuggestionsSchema.safeParse({
      ...legacy,
      suggestions: [{ ...rows[0], haveCount: 2 }],
    }).success,
  ).toBe(false);
  expect(
    cookSuggestionsSchema.safeParse({
      ...legacy,
      suggestions: [rows[0], rows[0]],
    }).success,
  ).toBe(false);
});
