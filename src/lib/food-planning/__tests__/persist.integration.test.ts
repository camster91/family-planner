import { issueFoodReviewSeal } from "../review-proof";
/** Authored/unrun. Opt-in disposable PostgreSQL only; the injected fixture guard
 * tests composition, NOT the still-required signed food-source verifier. */
import { randomUUID } from "node:crypto";
import { assertFixtureTargetAllowed } from "../../fixtures/guard";
import { defaultFeatures } from "../../features";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "../../idempotency";
import { undoGroceryAdd } from "../../grocery-from-recipe";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  persistReviewedFoodPlan,
  foodApplyReceipt,
  type ReviewedFoodWrite,
  type FoodWriteSourceGuard,
} from "../persist";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(60000);
suite("food plan canonical atomic write composition", () => {
  let db: NonNullable<typeof import("../../prisma").prisma>;
  const familyId = `food-save-${randomUUID()}`,
    userId = `${familyId}-parent`;
  const otherFamilyId = `food-save-other-${randomUUID()}`;
  const actor = { familyId, userId, role: "parent", generation: 0 };
  let foreignListId: string;
  let recipeId: string, ingredientId: string, listId: string;
  const previous = process.env.FAMILY_FOOD_PLANNING_READY;
  const guard = (): FoodWriteSourceGuard => ({
    verify: jest.fn(async () => {}),
    assertCurrent: jest.fn(),
  });
  function input(): ReviewedFoodWrite {
    return reviewedFoodWrite.parse({
      sourceRequest: {
        plan: {
          timeZone: "UTC",
          slots: [0, 1].map((i) => ({
            key: `slot-${i}`,
            date: `2026-10-${23 + i}`,
            mealType: "dinner",
            servings: 4,
            recipeId,
          })),
        },
      },
      protocol: "herewoven.food-apply.v1",
      mode: "meals",
      reviewProof: "fixture-only-not-a-real-proof",
      meals: [0, 1].map((i) => ({
        key: `slot-${i}`,
        input: {
          protocol: "herewoven.meal-create.v1",
          expected_user_id: userId,
          expected_family_id: familyId,
          issued_at: new Date().toISOString(),
          date: `2026-10-${23 + i}`,
          meal_type: "dinner",
          recipe_id: recipeId,
          servings: 4,
        },
      })),
      groceries: [{ key: "slot-0", listId, ingredientIds: [ingredientId] }],
    });
  }
  async function root(body: ReviewedFoodWrite) {
    // Real owner/command signature; the fixture guard only bypasses source reads.
    body.reviewProof = issueFoodReviewSeal(
      actor,
      body,
      "a".repeat(64),
      {},
      new Date(),
    );
    return db.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: FOOD_APPLY_ACTION,
        request_hash: hashIdempotentRequest(FOOD_APPLY_ACTION, body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = (await import("../../prisma")).prisma!;
    await db.family.create({
      data: {
        id: familyId,
        name: "Synthetic food save",
        features: {
          ...defaultFeatures(),
          meals: true,
          inventory: true,
          lists: true,
        },
      },
    });
    await db.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        name: "Synthetic parent",
        email: `${userId}@example.invalid`,
        email_verified: true,
      },
    });
    ingredientId = (
      await db.ingredient.create({
        data: { family_id: familyId, name: "Fixture rice", unit: "g" },
      })
    ).id;
    recipeId = (
      await db.recipe.create({
        data: {
          family_id: familyId,
          created_by: userId,
          title: "Fixture rice",
          servings: 2,
          ingredients: {
            create: { ingredient_id: ingredientId, amount: 100, unit: "g" },
          },
        },
      })
    ).id;
    listId = (
      await db.list.create({
        data: {
          family_id: familyId,
          created_by: userId,
          name: "Fixture groceries",
          type: "grocery",
        },
      })
    ).id;
    await db.family.create({
      data: { id: otherFamilyId, name: "Foreign synthetic household" },
    });
    foreignListId = (
      await db.list.create({
        data: {
          family_id: otherFamilyId,
          created_by: userId,
          name: "Private foreign list",
          type: "grocery",
        },
      })
    ).id;
    process.env.FAMILY_FOOD_PLANNING_READY = "1";
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.FAMILY_FOOD_PLANNING_READY;
    else process.env.FAMILY_FOOD_PLANNING_READY = previous;
    await db.family.deleteMany({
      where: { id: { in: [familyId, otherFamilyId] } },
    });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });
  it("rolls back earlier meals and child receipts when the final grocery selection fails", async () => {
    const body = input();
    body.groceries[0].ingredientIds = ["missing-ingredient"];
    const record = await root(body);
    const before = await db.familyMeal.count({
      where: { family_id: familyId },
    });
    await expect(
      persistReviewedFoodPlan(db, actor, body, record.id, guard()),
    ).rejects.toMatchObject({ result: { status: 400 } });
    expect(await db.familyMeal.count({ where: { family_id: familyId } })).toBe(
      before,
    );
    expect(
      await db.idempotencyRecord.count({
        where: {
          scope: `user:${userId}`,
          key: { startsWith: `food-child:${record.id}:` },
        },
      }),
    ).toBe(0);
    expect(
      (
        await db.idempotencyRecord.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).response_status,
    ).toBeNull();
  });
  it("does not disclose a foreign list and rolls back the same way as a missing list", async () => {
    const before = await db.familyMeal.count({
      where: { family_id: familyId },
    });
    for (const selected of [foreignListId, "missing-fixture-list"]) {
      const body = input();
      body.groceries[0].listId = selected;
      const record = await root(body);
      await expect(
        persistReviewedFoodPlan(db, actor, body, record.id, guard()),
      ).rejects.toMatchObject({
        result: { status: 404, body: { error: { code: "LIST_NOT_FOUND" } } },
      });
    }
    expect(await db.familyMeal.count({ where: { family_id: familyId } })).toBe(
      before,
    );
    expect(await db.listItem.count({ where: { list_id: foreignListId } })).toBe(
      0,
    );
  });
  it("binds recovery to the exact frozen command before any source verification or effects", async () => {
    const body = input(),
      record = await root(body),
      source = guard();
    const changed = reviewedFoodWrite.parse({
      ...body,
      reviewProof: "different-fixture-proof",
    });
    await expect(
      persistReviewedFoodPlan(db, actor, changed, record.id, source),
    ).rejects.toThrow();
    expect(source.verify).not.toHaveBeenCalled();
  });
  it("commits ordinary meals with normal full scaled groceries and an undo-compatible child receipt", async () => {
    const body = input(),
      record = await root(body),
      source = guard();
    const result = await persistReviewedFoodPlan(
      db,
      actor,
      body,
      record.id,
      source,
    );
    const saved = foodApplyReceipt.parse(result.body);
    expect(saved.meals).toHaveLength(2);
    expect(source.verify).toHaveBeenCalledTimes(1);
    const grocery = saved.groceries[0];
    expect(
      await db.listItem.findFirst({
        where: { source_request_id: grocery.requestId },
      }),
    ).toMatchObject({ amount: 200, unit: "g", meal_id: saved.meals[0].mealId });
    const undone = await undoGroceryAdd(
      db,
      grocery.requestId,
      { id: userId, family_id: familyId },
      "grocery.add-from-recipe",
    );
    expect(undone.status).toBe(200);
    expect(
      await db.listItem.count({
        where: { source_request_id: grocery.requestId },
      }),
    ).toBe(0);
    // A deleted target and paused rollout do not turn replay into a new effect.
    await db.familyMeal.delete({ where: { id: saved.meals[0].mealId } });
    process.env.FAMILY_FOOD_PLANNING_READY = "0";
    try {
      const replayGuard = guard();
      expect(
        (await persistReviewedFoodPlan(db, actor, body, record.id, replayGuard))
          .body,
      ).toEqual(saved);
      expect(replayGuard.verify).not.toHaveBeenCalled();
      expect(
        await db.familyMeal.findUnique({
          where: { id: saved.meals[0].mealId },
        }),
      ).toBeNull();
      await expect(
        persistReviewedFoodPlan(
          db,
          { ...actor, generation: 1 },
          body,
          record.id,
          guard(),
        ),
      ).rejects.toMatchObject({ result: { status: 403 } });
    } finally {
      process.env.FAMILY_FOOD_PLANNING_READY = "1";
    }
  });
  it("does not replay an old-generation receipt into a newly authorized generation", async () => {
    const body = input();
    body.groceries = [];
    const record = await root(body);
    await persistReviewedFoodPlan(db, actor, body, record.id, guard());
    await db.user.update({ where: { id: userId }, data: { token_version: 1 } });
    const source = guard();
    try {
      await expect(
        persistReviewedFoodPlan(
          db,
          { ...actor, generation: 1 },
          body,
          record.id,
          source,
        ),
      ).rejects.toThrow();
      expect(source.verify).not.toHaveBeenCalled();
    } finally {
      await db.user.update({
        where: { id: userId },
        data: { token_version: 0 },
      });
    }
  });
  it("rolls back every effect if the source lease expires at the final boundary", async () => {
    const body = input(),
      record = await root(body),
      source = guard();
    let checks = 0;
    source.assertCurrent = () => {
      if (++checks === 2) throw new Error("fixture lease expired");
    };
    const before = await db.familyMeal.count({
      where: { family_id: familyId },
    });
    await expect(
      persistReviewedFoodPlan(db, actor, body, record.id, source),
    ).rejects.toThrow("fixture lease expired");
    expect(await db.familyMeal.count({ where: { family_id: familyId } })).toBe(
      before,
    );
    expect(
      await db.idempotencyRecord.count({
        where: { key: { startsWith: `food-child:${record.id}:` } },
      }),
    ).toBe(0);
  });
  it("creates one unprepared multi-dish session without recording eaten food or stock consumption", async () => {
    const body = reviewedFoodWrite.parse({
      sourceRequest: {
        plan: {
          timeZone: "UTC",
          mode: "prep",
          slots: ["a", "b"].map((key) => ({
            key,
            date: "2026-10-23",
            mealType: "dinner",
            servings: 4,
            recipeId,
          })),
        },
      },
      protocol: "herewoven.food-apply.v1",
      mode: "prep",
      reviewProof: "fixture-only",
      dishKeys: ["a", "b"],
      groceries: [{ key: "a", listId, ingredientIds: [ingredientId] }],
      input: {
        expected_user_id: userId,
        expected_family_id: familyId,
        prepared_on: "2026-10-23",
        next_prep_on: "2026-10-30",
        dishes: ["a", "b"].map((name) => ({
          name,
          recipe_id: recipeId,
          total_servings: 4,
          reserve_storage: "fridge",
          meals: [],
        })),
      },
    });
    const record = await root(body);
    const saved = foodApplyReceipt.parse(
      (await persistReviewedFoodPlan(db, actor, body, record.id, guard())).body,
    );
    expect(saved.prep?.dishes).toHaveLength(2);
    expect(
      await db.mealPrepSession.findUnique({
        where: { id: saved.prep!.sessionId },
      }),
    ).toMatchObject({
      prepared_at: null,
      next_prep_on: new Date("2026-10-30T00:00:00Z"),
    });
    expect(
      await db.mealBatchConsumption.count({ where: { family_id: familyId } }),
    ).toBe(0);
    expect(
      await db.listItem.findFirst({
        where: { source_request_id: saved.groceries[0].requestId },
      }),
    ).toMatchObject({
      amount: 200,
      source_key: `batch:${saved.prep!.dishes[0].batchId}`,
    });
    await db.user.update({
      where: { id: userId },
      data: { email_verified: false },
    });
    try {
      await expect(
        persistReviewedFoodPlan(db, actor, body, record.id, guard()),
      ).rejects.toMatchObject({ result: { status: 401 } });
    } finally {
      await db.user.update({
        where: { id: userId },
        data: { email_verified: true },
      });
    }
  });
});
