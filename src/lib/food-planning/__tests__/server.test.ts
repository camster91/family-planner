jest.mock("../source-versions", () => ({
  readFoodSourceVersions: jest.fn(async () => []),
}));
import { readFoodSourceVersions } from "../source-versions";
/** Authored/unrun. Mocked snapshots do not prove PostgreSQL isolation. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-food-planning-key",
}));
import { previewFoodPlan, foodPreviewRequest } from "../server";
import { defaultFeatures } from "../../features";
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 2,
};
const now = new Date("2026-10-22T12:00:00Z");
const query = foodPreviewRequest.parse({
  plan: {
    timeZone: "UTC",
    slots: [
      { key: "dinner", date: "2026-10-22", mealType: "dinner", servings: 2 },
    ],
  },
});
const original = process.env.FAMILY_FOOD_PLANNING_READY;
beforeEach(() => {
  process.env.FAMILY_FOOD_PLANNING_READY = "1";
  jest.mocked(readFoodSourceVersions).mockReset().mockResolvedValue([]);
  jest.spyOn(Date, "now").mockReturnValue(+now);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (original === undefined) delete process.env.FAMILY_FOOD_PLANNING_READY;
  else process.env.FAMILY_FOOD_PLANNING_READY = original;
});
function fixture() {
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray) =>
      query.join("").includes("AS invalid") ? [{ invalid: false }] : [],
    ),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        family_id: actor.familyId,
        role: "parent",
        token_version: 2,
      }),
    },
    family: {
      findUnique: jest.fn().mockResolvedValue({
        features: { ...defaultFeatures(), meals: true, inventory: true },
      }),
    },
    recipe: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "recipe-a",
          title: "Synthetic rice",
          servings: 2,
          prep_time: 5,
          cook_time: 15,
          revision: 0,
          ingredients: [
            {
              id: "line-a",
              amount: 100,
              unit: "g",
              ingredient: {
                id: "ingredient-a",
                family_id: actor.familyId,
                name: "Rice",
                unit: "g",
              },
            },
          ],
        },
      ]),
    },
    inventoryItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "stock-a",
          name: "Rice",
          ingredient_id: "ingredient-a",
          amount: 200,
          unit: "g",
          expires_on: null,
          date_kind: "best_before",
          status: "active",
          ingredient: { id: "ingredient-a", family_id: actor.familyId },
        },
      ]),
    },
    familyMeal: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const db = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  return { tx, db };
}
it("uses current owner/role/generation and same-household canonical rows, without requesting private recipe prose or author fields", async () => {
  const { tx, db } = fixture();
  const result = await previewFoodPlan(db as never, actor, query, now);
  expect(result.plan.slots[0].choice!.coveredCount).toBe(1);
  expect(result.plan).toMatchObject({
    writesPerformed: false,
    stockReserved: false,
    calendarChecked: false,
  });
  expect(result.owner).toEqual(actor);
  expect(result.snapshotRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(tx.recipe.findMany.mock.calls[0][0].where).toEqual({
    family_id: actor.familyId,
  });
  expect(tx.inventoryItem.findMany.mock.calls[0][0].where.family_id).toBe(
    actor.familyId,
  );
  expect(tx.recipe.findMany.mock.calls[0][0].select).not.toHaveProperty(
    "instructions",
  );
  expect(tx.recipe.findMany.mock.calls[0][0].select).not.toHaveProperty(
    "created_by",
  );
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: "RepeatableRead",
  });
});
it("refuses a changed actor before source reads and refuses a foreign nested ingredient without leaking its text", async () => {
  const { tx, db } = fixture();
  tx.user.findUnique.mockResolvedValueOnce({
    family_id: actor.familyId,
    role: "parent",
    token_version: 3,
  });
  await expect(
    previewFoodPlan(db as never, actor, query, now),
  ).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
  expect(tx.recipe.findMany).not.toHaveBeenCalled();
  const foreign = fixture();
  foreign.tx.recipe.findMany.mockResolvedValueOnce([
    {
      id: "recipe-a",
      title: "Own recipe",
      servings: 2,
      prep_time: 1,
      cook_time: 1,
      revision: 0,
      ingredients: [
        {
          id: "line-a",
          amount: 1,
          unit: "g",
          ingredient: {
            id: "ingredient-foreign",
            family_id: "family-b",
            name: "Foreign fixture text",
            unit: "g",
          },
        },
      ],
    },
  ]);
  await expect(
    previewFoodPlan(foreign.db as never, actor, query, now),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(foreign.tx.inventoryItem.findMany).not.toHaveBeenCalled();
});
it("does not promote a capped recipe library into complete coverage and rejects child access", async () => {
  const { tx, db } = fixture();
  tx.recipe.findMany.mockResolvedValueOnce(
    Array.from({ length: 101 }, (_, i) => ({
      id: `recipe-${i}`,
      title: "Synthetic",
      servings: 2,
      prep_time: 1,
      cook_time: 1,
      revision: 0,
      ingredients: [],
    })),
  );
  await expect(
    previewFoodPlan(db as never, actor, query, now),
  ).rejects.toMatchObject({ code: "RECIPES_FILTER_REQUIRED" });
  await expect(
    previewFoodPlan(db as never, { ...actor, role: "child" }, query, now),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("loads commitments from today even when the requested new slot starts later", async () => {
  const { tx, db } = fixture();
  tx.familyMeal.findMany.mockResolvedValueOnce([
    {
      id: "existing-lunch",
      date: new Date("2026-10-22T00:00:00Z"),
      meal_type: "lunch",
      recipe_id: "recipe-a",
      batch_id: null,
      servings: 2,
    },
  ]);
  const later = foodPreviewRequest.parse({
    plan: {
      timeZone: "UTC",
      slots: [
        { key: "later", date: "2026-10-23", mealType: "dinner", servings: 2 },
      ],
    },
  });
  const result = await previewFoodPlan(db as never, actor, later, now);
  expect(tx.familyMeal.findMany.mock.calls[0][0].where.date.gte).toEqual(
    new Date("2026-10-22T00:00:00Z"),
  );
  expect(result.plan.existingMealReservationsChecked).toBe(true);
  expect(result.plan.slots[0].choice!.ingredients[0]).toMatchObject({
    required: 100,
    recordedAvailable: 100,
  });
});
it("binds the bounded dependency graph's row versions even when source values return unchanged", async () => {
  const { tx, db } = fixture();
  const version = {
    kind: "Ingredient" as const,
    id: "ingredient-a",
    generation: "50171c0a-725e-4d28-8318-79c61f284120",
    epoch: 0,
  };
  jest
    .mocked(readFoodSourceVersions)
    .mockResolvedValueOnce([version])
    .mockResolvedValueOnce([{ ...version, epoch: 2 }]);
  const first = await previewFoodPlan(db as never, actor, query, now);
  const restored = await previewFoodPlan(db as never, actor, query, now);
  expect(first.plan).toEqual(restored.plan);
  expect(first.snapshotRevision).not.toBe(restored.snapshotRevision);
  expect(readFoodSourceVersions).toHaveBeenLastCalledWith(
    tx,
    actor.familyId,
    expect.objectContaining({
      Family: [actor.familyId],
      User: [actor.userId],
      Recipe: ["recipe-a"],
      RecipeIngredient: ["line-a"],
      Ingredient: ["ingredient-a", "ingredient-a"],
      InventoryItem: ["stock-a"],
    }),
  );
});
