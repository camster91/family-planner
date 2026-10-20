import { scaleRecipeAmount, formatRecipeAmount } from "../recipe-scaling";
import { addFromRecipeSchema } from "../grocery-from-recipe";
describe("read-only recipe quantities", () => {
  it("uses only reviewed numeric amounts and preserves meaningful tiny quantities", () => {
    expect(scaleRecipeAmount(2, 4, 6)).toBe(3);
    expect(scaleRecipeAmount(0.001, 4, 2)).toBe(0.0005);
    expect(formatRecipeAmount(0.0005, "tsp", "en")).toBe("0.0005 tsp");
    expect(formatRecipeAmount(1.5, "cups", "es")).toBe("1,5 cups");
  });
  it.each([
    [2, 0, 4],
    [2, 4, 101],
    [2, 4, 1.5],
    [Infinity, 4, 2],
    [-1, 4, 2],
  ])("refuses invalid arithmetic %j", (amount, base, target) => {
    expect(scaleRecipeAmount(amount, base, target)).toBeNull();
  });
  it("accepts the same 100-portion ceiling for recipe grocery requests", () => {
    expect(
      addFromRecipeSchema.safeParse({
        recipeId: "fixture_recipe",
        servings: 100,
      }).success,
    ).toBe(true);
    expect(
      addFromRecipeSchema.safeParse({
        recipeId: "fixture_recipe",
        servings: 101,
      }).success,
    ).toBe(false);
  });
});
