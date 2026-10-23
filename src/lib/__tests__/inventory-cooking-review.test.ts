/** Source only. Canonical DB/route isolation acceptance remains deferred. */
import type { PrismaClient } from "@prisma/client";
import { reviewCookingStock } from "../inventory-cooking-review";
import { inventoryIntakeAuthority } from "../inventory-intake";
jest.mock("../inventory-intake", () => ({
  inventoryIntakeAuthority: jest.fn(),
}));
const actor = {
  userId: "fixture-parent",
  familyId: "fixture-family",
  tokenVersion: 0,
};
const recipe = {
  id: "fixture-recipe",
  title: "Fixture supper",
  servings: 2,
  ingredients: [
    {
      id: "line-a",
      amount: 200,
      unit: "g",
      ingredient: { id: "beans", name: "Fixture beans", unit: "g" },
    },
  ],
};
const tx = {
  family: { findUnique: jest.fn() },
  recipe: { findFirst: jest.fn() },
  ingredient: { findMany: jest.fn() },
  mealBatch: { findFirst: jest.fn() },
  mealPrepSession: { findFirst: jest.fn() },
};
const db = {
  $transaction: async (run: (tx: object) => unknown) => run(tx),
} as unknown as Pick<PrismaClient, "$transaction">;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(inventoryIntakeAuthority).mockResolvedValue(null);
  tx.family.findUnique.mockResolvedValue({
    features: { inventory: true, meals: true },
  });
  tx.recipe.findFirst.mockResolvedValue(recipe);
  tx.ingredient.findMany.mockResolvedValue([{ id: "beans" }]);
});
it("returns bounded current-recipe guidance with explicit actor and selected portions", async () => {
  const result = await reviewCookingStock(db, actor, {
    kind: "recipe",
    id: recipe.id,
    servings: 4,
  });
  expect(result).toMatchObject({
    status: 200,
    body: { userId: actor.userId, familyId: actor.familyId },
  });
  expect(result.body).toMatchObject({
    basis: "current-recipe",
    baseServings: 2,
    targetServings: 4,
    lines: [{ amount: 200, unit: "g" }],
  });
  expect(tx.recipe.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: recipe.id, family_id: actor.familyId },
    }),
  );
});
it("refuses changed authority and foreign/missing live ingredients before returning content", async () => {
  jest
    .mocked(inventoryIntakeAuthority)
    .mockResolvedValueOnce({
      status: 403,
      body: { error: { code: "INTAKE_FORBIDDEN" } },
    });
  expect(
    (await reviewCookingStock(db, actor, { kind: "recipe", id: recipe.id }))
      .status,
  ).toBe(403);
  expect(tx.recipe.findFirst).not.toHaveBeenCalled();
  tx.ingredient.findMany.mockResolvedValue([]);
  expect(
    await reviewCookingStock(db, actor, { kind: "recipe", id: recipe.id }),
  ).toEqual({
    status: 409,
    body: { error: { code: "COOKING_SOURCE_UNAVAILABLE" } },
  });
});
it("uses a prepared snapshot instead of the subsequently edited recipe", async () => {
  tx.mealBatch.findFirst.mockResolvedValue({
    recipe_id: recipe.id,
    total_servings: 6,
    prep_session_id: "prep-a",
    recipe_snapshot_at: new Date(),
    recipe_snapshot: {
      v: 1,
      recipe: {
        ...recipe,
        title: "Original cooked recipe",
        revision: 0,
        description: null,
        instructions: null,
        source_url: null,
        prep_time: null,
        cook_time: null,
        ingredients: recipe.ingredients.map((line) => ({
          ...line,
          note: null,
        })),
      },
    },
  });
  tx.mealPrepSession.findFirst.mockResolvedValue({ prepared_at: new Date() });
  const result = await reviewCookingStock(db, actor, {
    kind: "batch",
    id: "batch-a",
  });
  expect(result).toMatchObject({
    status: 200,
    body: {
      title: "Original cooked recipe",
      basis: "prepared-snapshot",
      targetServings: 6,
    },
  });
  expect(tx.recipe.findFirst).not.toHaveBeenCalled();
  tx.mealBatch.findFirst.mockResolvedValue(null);
  expect(
    (
      await reviewCookingStock(db, actor, {
        kind: "batch",
        id: "foreign-batch",
      })
    ).status,
  ).toBe(404);
});
it("does not substitute a live recipe when prepared history is missing", async () => {
  tx.mealBatch.findFirst.mockResolvedValue({
    recipe_id: recipe.id,
    total_servings: 6,
    prep_session_id: "prep-a",
    recipe_snapshot_at: null,
    recipe_snapshot: null,
  });
  tx.mealPrepSession.findFirst.mockResolvedValue({ prepared_at: new Date() });
  expect(
    (await reviewCookingStock(db, actor, { kind: "batch", id: "batch-a" }))
      .status,
  ).toBe(409);
  expect(tx.recipe.findFirst).not.toHaveBeenCalled();
});
