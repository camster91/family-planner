/** Authored/unrun. Metadata/ownership/cap contracts; no SQL execution. */
import {
  readFoodSourceVersions,
  foodSourceStorageAvailable,
} from "../source-versions";
const generation = "50171c0a-725e-4d28-8318-79c61f284120";
const row = (kind: "Ingredient" | "RecipeIngredient", id: string) => ({
  kind,
  id,
  generation,
  epoch: 0,
});
function reader(rows: unknown[], ready = true) {
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ ready }])
      .mockResolvedValueOnce(rows),
  };
}
it("requires source fields and the exact enabled insert/update trigger before accepting versions", async () => {
  const tx = reader([], false);
  await expect(
    readFoodSourceVersions(tx as never, "family-a", {
      Ingredient: ["ingredient-a"],
    }),
  ).rejects.toThrow();
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(
    await foodSourceStorageAvailable({
      $queryRaw: jest.fn(async () => []),
    } as never),
  ).toBe(false);
});
it("scopes ordinary rows and both recipe-line owners without requesting content", async () => {
  const tx = reader([
    row("RecipeIngredient", "line-a"),
    row("Ingredient", "ingredient-a"),
  ]);
  const result = await readFoodSourceVersions(tx as never, "family-a", {
    Ingredient: ["ingredient-a", "ingredient-a"],
    RecipeIngredient: ["line-a"],
  });
  expect(result.map((row) => row.kind)).toEqual([
    "Ingredient",
    "RecipeIngredient",
  ]);
  const sql = tx.$queryRaw.mock.calls[1][0] as {
    sql: string;
    values: unknown[];
  };
  expect(sql.sql).toContain('source_row."family_id"');
  expect(sql.sql).toContain('r."family_id"');
  expect(sql.sql).toContain('i."family_id"');
  expect(sql.sql).not.toMatch(
    /SELECT \*|instructions|email|password|description/,
  );
  expect(sql.values).toContain("family-a");
});
it("refuses incomplete/foreign/duplicated/malformed source sets rather than silently omitting them", async () => {
  for (const rows of [
    [],
    [row("Ingredient", "foreign-id")],
    [{ ...row("Ingredient", "ingredient-a"), epoch: -1 }],
    [{ ...row("Ingredient", "ingredient-a"), epoch: 2147483647 }],
    [{ ...row("Ingredient", "ingredient-a"), generation: "invalid" }],
    [row("Ingredient", "ingredient-a"), row("Ingredient", "ingredient-a")],
  ]) {
    await expect(
      readFoodSourceVersions(reader(rows) as never, "family-a", {
        Ingredient: ["ingredient-a"],
      }),
    ).rejects.toThrow();
  }
});
it("bounds selectors and refuses unknown dynamic table names before SQL", async () => {
  for (const selected of [
    { Ingredient: Array.from({ length: 6001 }, (_, i) => `ingredient-${i}`) },
    { Unexpected: ["row-a"] },
    { Ingredient: [""] },
  ]) {
    const tx = reader([]);
    await expect(
      readFoodSourceVersions(tx as never, "family-a", selected as never),
    ).rejects.toThrow();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  }
});
