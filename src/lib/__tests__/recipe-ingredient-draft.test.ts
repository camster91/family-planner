import { recipeIngredientDraft } from "../recipe-ingredient-draft";
test.each([
  ["2 carrots", "carrots", "2", ""],
  ["1 1/2 cups flour", "flour", "1.5", "cups"],
  ["1/2 tsp salt", "salt", "0.5", "tsp"],
  ["250 grams chickpeas", "chickpeas", "250", "grams"],
])("suggests explicit quantities for %s", (raw, name, amount, unit) => {
  expect(recipeIngredientDraft(raw)).toEqual({ name, amount, unit, note: "" });
});
test.each([
  "salt to taste",
  "1-2 onions",
  "1 – 2 onions",
  "2 400g cans tomatoes",
  "2 x 400g cans tomatoes",
  "1 to 2 onions",
  "1/0 cup water",
  "½ lemon",
  "100001 g flour",
])("keeps uncertain %s verbatim without invented quantities", (raw) => {
  expect(recipeIngredientDraft(raw)).toEqual({
    name: raw,
    amount: "",
    unit: "",
    note: "",
  });
});
