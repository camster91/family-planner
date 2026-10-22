/** Authored/unrun. Mock renewal boundaries; real DB isolation is separate. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-food-review-secret",
}));
jest.mock("../server", () => ({
  foodPlanningEnabled: jest.fn(() => true),
  previewFoodPlanInTx: jest.fn(),
}));
import { reviewedFoodWrite } from "../apply-contract";
import { buildFoodPlan } from "../planner";
import { foodPreviewRequest } from "../contract";
import { foodPlanningEnabled, previewFoodPlanInTx } from "../server";
import {
  assertFoodWriteChoices,
  reviewFoodPlanWrite,
  createFoodWriteSourceGuard,
} from "../review";
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 2,
};
const now = new Date("2026-10-22T12:00:00Z");
function fixture() {
  const sourceRequest = foodPreviewRequest.parse({
    plan: {
      timeZone: "UTC",
      slots: [
        {
          key: "dinner",
          date: "2026-10-22",
          mealType: "dinner",
          servings: 2,
          recipeId: "recipe-a",
        },
      ],
    },
  });
  const plan = buildFoodPlan(sourceRequest.plan, {
    recipes: [
      {
        id: "recipe-a",
        title: "Synthetic rice",
        servings: 2,
        prep_time: 5,
        cook_time: 15,
        ingredients: [
          {
            amount: 100,
            unit: "g",
            ingredient: { id: "ingredient-a", name: "Rice", unit: "g" },
          },
        ],
      },
    ],
    stock: [],
    occupied: [],
    coverage: { recipes: true, stock: true, meals: true },
  });
  const input = reviewedFoodWrite.parse({
    sourceRequest,
    protocol: "herewoven.food-apply.v1",
    mode: "meals",
    reviewProof: "not-issued",
    meals: [
      {
        key: "dinner",
        input: {
          protocol: "herewoven.meal-create.v1",
          expected_user_id: actor.userId,
          expected_family_id: actor.familyId,
          issued_at: now.toISOString(),
          date: "2026-10-22",
          meal_type: "dinner",
          recipe_id: "recipe-a",
          servings: 2,
        },
      },
    ],
    groceries: [],
  });
  const tx = {
    user: { findMany: jest.fn(async () => []) },
    list: { findMany: jest.fn(async () => []) },
    familyMeal: { findMany: jest.fn(async () => []) },
    recipe: { findMany: jest.fn(async () => []) },
  };
  const db = {
    $transaction: jest.fn(async (run: (client: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  const observation = {
    owner: actor,
    generatedAt: now.toISOString(),
    expiresAt: new Date(+now + 60000).toISOString(),
    snapshotRevision: "a".repeat(64),
    recipeScope: "library" as const,
    plan,
  };
  jest.mocked(previewFoodPlanInTx).mockResolvedValue(observation);
  return { input, plan, tx, db, observation };
}
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(+now);
  jest.mocked(foodPlanningEnabled).mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
it("issues a read review and renews it on the exact supplied write transaction", async () => {
  const { input, tx, db } = fixture();
  const review = await reviewFoodPlanWrite(db as never, actor, input, now);
  const guard = createFoodWriteSourceGuard();
  expect(() => guard.assertCurrent()).toThrow();
  await guard.verify(tx as never, actor, review.input);
  expect(
    jest.mocked(previewFoodPlanInTx).mock.calls[
      jest.mocked(previewFoodPlanInTx).mock.calls.length - 1
    ]?.[0],
  ).toBe(tx);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(() => guard.assertCurrent()).not.toThrow();
  jest.spyOn(Date, "now").mockReturnValue(+now + 60000);
  expect(() => guard.assertCurrent()).toThrow();
});
it("refuses changed sources, modified writable fields and paused readiness", async () => {
  const { input, db, tx, observation } = fixture();
  const review = await reviewFoodPlanWrite(db as never, actor, input, now);
  jest
    .mocked(previewFoodPlanInTx)
    .mockResolvedValue({ ...observation, snapshotRevision: "b".repeat(64) });
  await expect(
    createFoodWriteSourceGuard().verify(tx as never, actor, review.input),
  ).rejects.toThrow();
  jest.mocked(previewFoodPlanInTx).mockResolvedValue(observation);
  if (review.input.mode !== "meals") throw new Error("fixture");
  const changed = reviewedFoodWrite.parse({
    ...review.input,
    meals: [
      {
        ...review.input.meals[0],
        input: {
          ...review.input.meals[0].input,
          notes: "modified after review",
        },
      },
    ],
  });
  await expect(
    createFoodWriteSourceGuard().verify(tx as never, actor, changed),
  ).rejects.toThrow();
  const guard = createFoodWriteSourceGuard();
  await guard.verify(tx as never, actor, review.input);
  jest.mocked(foodPlanningEnabled).mockReturnValue(false);
  expect(() => guard.assertCurrent()).toThrow();
});
it("refuses held, occupied, mismatched-portion and missing-source choices", () => {
  const { input, plan } = fixture();
  expect(() => assertFoodWriteChoices(actor, input, plan)).not.toThrow();
  expect(() =>
    assertFoodWriteChoices(actor, input, {
      ...plan,
      slots: [{ ...plan.slots[0], holds: ["slot-occupied"] }],
    }),
  ).toThrow();
  const changed = reviewedFoodWrite.parse({
    ...input,
    meals:
      input.mode === "meals"
        ? [
            {
              ...input.meals[0],
              input: { ...input.meals[0].input, servings: 4 },
            },
          ]
        : [],
  });
  expect(() => assertFoodWriteChoices(actor, changed, plan)).toThrow();
  expect(() =>
    assertFoodWriteChoices(actor, input, { ...plan, slots: [] }),
  ).toThrow();
});
it("binds the current own cook metadata and refuses foreign/missing cook IDs alike", async () => {
  const { input, tx, db } = fixture();
  if (input.mode !== "meals") throw new Error("fixture");
  input.meals[0].input.cook_id = "cook-a";
  await expect(
    reviewFoodPlanWrite(db as never, actor, input, now),
  ).rejects.toThrow();
  tx.user.findMany.mockResolvedValue([
    { id: "cook-a", name: "Synthetic cook", role: "teen", token_version: 1 },
  ] as never);
  const review = await reviewFoodPlanWrite(db as never, actor, input, now);
  tx.user.findMany.mockResolvedValue([
    { id: "cook-a", name: "Changed cook", role: "teen", token_version: 1 },
  ] as never);
  await expect(
    createFoodWriteSourceGuard().verify(tx as never, actor, review.input),
  ).rejects.toThrow();
});
it("shows exact full recipe grocery amounts and binds later auxiliary changes", async () => {
  const { input, tx, db } = fixture();
  input.groceries = [
    { key: "dinner", listId: "list-a", ingredientIds: ["ingredient-a"] },
  ];
  tx.list.findMany.mockResolvedValue([
    {
      id: "list-a",
      name: "Synthetic groceries",
      type: "grocery",
      updated_at: now,
    },
  ] as never);
  const recipe = {
    id: "recipe-a",
    servings: 2,
    ingredients: [
      {
        ingredient_id: "ingredient-a",
        amount: 100,
        unit: "g",
        ingredient: { name: "Rice", unit: "g", family_id: actor.familyId },
      },
    ],
  };
  tx.recipe.findMany.mockResolvedValue([recipe] as never);
  const review = await reviewFoodPlanWrite(db as never, actor, input, now);
  expect(review.groceries[0]).toMatchObject({
    quantityBasis: "full-scaled-recipe",
    ingredients: [{ ingredientId: "ingredient-a", amount: 100, unit: "g" }],
  });
  tx.list.findMany.mockResolvedValue([
    { id: "list-a", name: "Renamed list", type: "grocery", updated_at: now },
  ] as never);
  await expect(
    createFoodWriteSourceGuard().verify(tx as never, actor, review.input),
  ).rejects.toThrow();
});
