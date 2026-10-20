/** Source cases only; no database or household records are created. */
import type { Prisma } from "@prisma/client";
import { weeklyRecipeGaps } from "@/lib/weekly-reset-gaps";
const from = new Date("2026-10-19T00:00:00Z"),
  end = new Date("2026-10-26T00:00:00Z"),
  today = new Date("2026-10-23T00:00:00Z");
const ingredient = (id: string, name: string, family_id = "family-a") => ({
  ingredient: { id, name, family_id },
});
function fixture() {
  const tx = {
    familyMeal: {
      findMany: jest.fn(async () => [
        { recipe_id: "recipe-a" as string | null, date: from },
      ]),
    },
    recipe: {
      findMany: jest.fn(async () => [
        {
          id: "recipe-a",
          title: "Soup",
          ingredients: [
            ingredient("beans", "Beans"),
            ingredient("carrots", "Carrots"),
          ],
        },
      ]),
    },
    inventoryItem: { findMany: jest.fn(async () => [] as unknown[]) },
  };
  return { tx, db: tx as unknown as Prisma.TransactionClient };
}
it("uses canonical linked/name stock presence, deduplicates repeated recipe meals and links existing recipe review", async () => {
  const { tx, db } = fixture();
  tx.familyMeal.findMany.mockResolvedValue([
    { recipe_id: "recipe-a", date: from },
    { recipe_id: "recipe-a", date: today },
  ]);
  tx.inventoryItem.findMany.mockResolvedValue([
    {
      ingredient_id: null,
      name: " beans ",
      expires_on: null,
      date_kind: "best_before",
      amount: null,
      status: "active",
    },
  ]);
  const result = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(result.incomplete).toBe(false);
  expect(result.group.rows).toEqual([
    {
      title: "Carrots",
      when: "2026-10-19",
      sourceTitle: "Soup",
      href: "/dashboard/meals/recipes/recipe-a",
    },
  ]);
  expect(tx.recipe.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { family_id: "family-a", id: { in: ["recipe-a"] } },
      take: 8,
    }),
  );
  expect(tx.inventoryItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        family_id: "family-a",
        OR: [{ expires_on: null }, { expires_on: { gte: today } }],
      }),
      take: 501,
    }),
  );
});
it("does not treat zero stock or food already past use-by as available on an earlier review day", async () => {
  const { tx, db } = fixture();
  tx.inventoryItem.findMany.mockResolvedValue([
    {
      ingredient_id: "beans",
      name: "Beans",
      expires_on: new Date("2026-10-22T00:00:00Z"),
      date_kind: "use_by",
      amount: 3,
      status: "active",
    },
    {
      ingredient_id: "carrots",
      name: "Carrots",
      expires_on: null,
      amount: 0,
      status: "active",
    },
  ]);
  const result = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(result.group.rows.map((row) => row.title)).toEqual([
    "Beans",
    "Carrots",
  ]);
});
it("holds ingredient conclusions when inventory is truncated", async () => {
  const { tx, db } = fixture();
  tx.inventoryItem.findMany.mockResolvedValue(
    Array.from({ length: 501 }, () => ({
      ingredient_id: null,
      name: "Food",
      expires_on: null,
      amount: 1,
      status: "active",
    })),
  );
  const result = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(result).toMatchObject({
    incomplete: true,
    group: { incomplete: true, more: true, rows: [] },
  });
});
it("distinguishes no linked recipes from a completed ingredient comparison", async () => {
  const { tx, db } = fixture();
  tx.familyMeal.findMany.mockResolvedValue([{ recipe_id: null, date: from }]);
  const value = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(value).toMatchObject({
    incomplete: true,
    group: { compared: 0, incomplete: true, rows: [] },
  });
  expect(tx.recipe.findMany).not.toHaveBeenCalled();
  expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
});
it("does not reveal foreign recipe or ingredient data and reports unavailable/missing recipe coverage", async () => {
  const { tx, db } = fixture();
  tx.recipe.findMany.mockResolvedValue([
    {
      id: "recipe-a",
      title: "Must not escape",
      ingredients: [ingredient("foreign", "Private foreign name", "family-b")],
    },
  ]);
  const result = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(result.incomplete).toBe(true);
  expect(result.group.rows).toEqual([]);
  tx.recipe.findMany.mockResolvedValue([]);
  expect(
    (await weeklyRecipeGaps(db, "family-a", from, end, today)).incomplete,
  ).toBe(true);
});
it("caps gaps and marks unknown ingredients rather than interpreting an empty or oversized recipe as complete coverage", async () => {
  const { tx, db } = fixture();
  tx.recipe.findMany.mockResolvedValue([
    {
      id: "recipe-a",
      title: "Soup",
      ingredients: Array.from({ length: 10 }, (_, n) =>
        ingredient(`item-${n}`, `Item ${n}`),
      ),
    },
  ]);
  const capped = await weeklyRecipeGaps(db, "family-a", from, end, today);
  expect(capped.group.rows).toHaveLength(8);
  expect(capped.group.more).toBe(true);
  for (const size of [0, 101]) {
    tx.recipe.findMany.mockResolvedValue([
      {
        id: "recipe-a",
        title: "Soup",
        ingredients: Array.from({ length: size }, (_, n) =>
          ingredient(`item-${n}`, `Item ${n}`),
        ),
      },
    ]);
    const held = await weeklyRecipeGaps(db, "family-a", from, end, today);
    expect(held.incomplete).toBe(true);
    expect(held.group.rows).toEqual([]);
  }
});
