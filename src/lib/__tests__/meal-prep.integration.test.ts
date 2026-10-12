/** Real transaction tests; only an explicitly allowed disposable database. */
import crypto from "node:crypto";
import { prisma } from "../prisma";
import { assertFixtureTargetAllowed } from "../fixtures/guard";
import { persistMealPrepInTx } from "../meal-batch-api";
import { mutateBatchedMeal } from "../batched-meal-edit";
import { addRecipeToGroceries } from "../grocery-from-recipe";
import { createMealPrepSchema, type MealPrepAction } from "../meal-batches";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("multi-dish prep transactions", () => {
  const familyId = `bulk-qa-${crypto.randomUUID()}`;
  const userId = `${familyId}-parent`;
  const actor = { familyId, userId, tokenVersion: 0 };
  let batchId: string, sessionId: string, mealId: string;
  const context = { expected_family_id: familyId, expected_user_id: userId };
  const draft = () =>
    createMealPrepSchema.parse({
      ...context,
      prepared_on: "2026-10-12",
      next_prep_on: "2026-10-19",
      dishes: [
        {
          name: "Soup",
          total_servings: 10,
          reserve_storage: "freezer",
          meals: [{ date: "2026-10-13", meal_type: "dinner", servings: 4 }],
        },
        {
          name: "Rice",
          total_servings: 6,
          reserve_storage: "fridge",
          meals: [],
        },
      ],
    });
  async function receipt() {
    return prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: "meal-prep.qa",
        request_hash: "qa",
        expires_at: new Date(Date.now() + 3600000),
      },
    });
  }
  async function action(
    input:
      | Omit<MealPrepAction, "expected_family_id" | "expected_user_id">
      | Record<string, unknown>,
  ) {
    const r = await receipt();
    return prisma!.$transaction((tx) =>
      persistMealPrepInTx(
        tx,
        actor,
        { ...context, ...input } as MealPrepAction,
        r.id,
      ),
    );
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.create({
      data: { id: familyId, name: "Isolated bulk QA" },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        email: `${familyId}@example.invalid`,
        name: "QA Parent",
        family_id: familyId,
        email_verified: true,
      },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: familyId } });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("commits both dishes, canonical meal and receipt together; replay creates nothing", async () => {
    const r = await receipt();
    const first = await prisma!.$transaction((tx) =>
      persistMealPrepInTx(tx, actor, draft(), r.id),
    );
    expect(first.status).toBe(201);
    const body = first.body as {
      sessionId: string;
      batchIds: string[];
      mealIds: string[];
    };
    [sessionId, batchId, mealId] = [
      body.sessionId,
      body.batchIds[0],
      body.mealIds[0],
    ];
    expect(body.batchIds).toHaveLength(2);
    const replay = await prisma!.$transaction((tx) =>
      persistMealPrepInTx(tx, actor, draft(), r.id),
    );
    expect(replay).toEqual(first);
    expect(
      await prisma!.mealPrepSession.count({ where: { family_id: familyId } }),
    ).toBe(1);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_status,
    ).toBe(201);
  });
  it("refuses eaten before preparation, then prevents consumption of reserved portions", async () => {
    expect(
      (await action({ action: "eaten", batch_id: batchId, servings: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await action({ action: "prepared", session_id: sessionId })).status,
    ).toBe(200);
    expect(
      (await action({ action: "eaten", batch_id: batchId, servings: 7 }))
        .status,
    ).toBe(409);
    expect(
      (
        await action({
          action: "eaten",
          batch_id: batchId,
          meal_id: mealId,
          servings: 2,
        })
      ).status,
    ).toBe(201);
  });
  it("serializes simultaneous allocations so only one can reserve the final six portions", async () => {
    const input = {
      action: "allocate",
      batch_id: batchId,
      meals: [{ date: "2026-10-14", meal_type: "lunch", servings: 6 }],
    };
    const results = await Promise.all([action(input), action(input)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it("preserves eaten portions through delete and restores only the outstanding reservation", async () => {
    const meal = await prisma!.familyMeal.findUniqueOrThrow({
      where: { id: mealId },
    });
    await prisma!.familyMeal.delete({ where: { id: mealId } });
    expect(
      await prisma!.mealBatchConsumption.count({
        where: { batch_id: batchId, meal_id: null },
      }),
    ).toBe(1);
    const restored = await action({
      action: "allocate",
      batch_id: batchId,
      restore_allocation_key: meal.batch_allocation_key,
      meals: [{ date: "2026-10-13", meal_type: "dinner", servings: 4 }],
    });
    expect(restored.status).toBe(201);
    expect(
      await prisma!.mealBatchConsumption.count({
        where: { batch_id: batchId, meal_id: null },
      }),
    ).toBe(0);
    expect(
      (
        await action({
          action: "allocate",
          batch_id: batchId,
          meals: [{ date: "2026-10-15", meal_type: "dinner", servings: 1 }],
        })
      ).status,
    ).toBe(409);
  });
  it("compares next prep before replacing it and refuses stale household and roles", async () => {
    expect(
      (
        await action({
          action: "next-prep",
          session_id: sessionId,
          next_prep_on: "2026-10-20",
          expected_next_prep_on: null,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await action({
          action: "next-prep",
          session_id: sessionId,
          next_prep_on: "2026-10-20",
          expected_next_prep_on: "2026-10-19",
        })
      ).status,
    ).toBe(200);
    expect(
      (await action({ action: "prepared", session_id: "foreign-session" }))
        .status,
    ).toBe(404);
    expect(
      (
        await action({
          action: "prepared",
          session_id: sessionId,
          expected_family_id: "foreign-family",
        })
      ).status,
    ).toBe(403);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "child" },
    });
    expect(
      (await action({ action: "prepared", session_id: sessionId })).status,
    ).toBe(403);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "parent" },
    });
  });
  it("preserves existing child meal edits while restricting child bulk management", async () => {
    const linked = await prisma!.familyMeal.findFirstOrThrow({
      where: { batch_id: batchId },
    });
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "child" },
    });
    expect(
      (await mutateBatchedMeal(actor, linked.id, { notes: "Packed for lunch" }))
        .status,
    ).toBe(200);
    expect(
      (await action({ action: "prepared", session_id: sessionId })).status,
    ).toBe(403);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "parent" },
    });
  });
  it("detaches both references when a free-text dish becomes independent", async () => {
    const linked = await prisma!.familyMeal.findFirstOrThrow({
      where: { batch_id: batchId },
    });
    expect(
      (
        await mutateBatchedMeal(actor, linked.id, {
          recipe_name: "Another dish",
        })
      ).status,
    ).toBe(200);
    const detached = await prisma!.familyMeal.findUniqueOrThrow({
      where: { id: linked.id },
    });
    expect(detached.batch_id).toBeNull();
    expect(detached.batch_allocation_key).toBeNull();
  });
  it("rolls back all dishes and receipt if the transaction fails after writing", async () => {
    const r = await receipt();
    await expect(
      prisma!.$transaction(async (tx) => {
        await persistMealPrepInTx(tx, actor, draft(), r.id);
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    expect(
      await prisma!.mealPrepSession.count({ where: { family_id: familyId } }),
    ).toBe(1);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_status,
    ).toBeNull();
  });
  it("scales linked grocery meals to the full dish once and refuses purchases after preparation", async () => {
    const recipe = await prisma!.recipe.create({
      data: {
        family_id: familyId,
        title: "QA soup",
        created_by: userId,
        servings: 4,
      },
    });
    const ingredient = await prisma!.ingredient.create({
      data: { family_id: familyId, name: "QA beans", unit: "cups" },
    });
    await prisma!.recipeIngredient.create({
      data: {
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        amount: 2,
        unit: "cups",
      },
    });
    const r = await receipt();
    const input = draft();
    input.dishes[0].recipe_id = recipe.id;
    const saved = await prisma!.$transaction((tx) =>
      persistMealPrepInTx(tx, actor, input, r.id),
    );
    const body = saved.body as {
      sessionId: string;
      batchIds: string[];
      mealIds: string[];
    };
    const groceryActor = { id: userId, family_id: familyId };
    const request = await receipt();
    const add = await addRecipeToGroceries(
      prisma!,
      {
        recipeId: recipe.id,
        mealId: body.mealIds[0],
        ingredientIds: undefined,
      },
      groceryActor,
      request.id,
    );
    expect(add.status).toBe(201);
    const rows = await prisma!.listItem.findMany({
      where: { source_key: `batch:${body.batchIds[0]}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(5);
    const second = await receipt();
    const duplicate = await addRecipeToGroceries(
      prisma!,
      {
        recipeId: recipe.id,
        batchId: body.batchIds[0],
        ingredientIds: undefined,
      },
      groceryActor,
      second.id,
    );
    expect(duplicate.body).toMatchObject({
      createdCount: 0,
      alreadyOnListCount: 1,
    });
    expect(
      (
        await addRecipeToGroceries(
          prisma!,
          {
            recipeId: recipe.id,
            mealId: body.mealIds[0],
            servings: 4,
            ingredientIds: undefined,
          },
          groceryActor,
          second.id,
        )
      ).status,
    ).toBe(400);
    await action({ action: "prepared", session_id: body.sessionId });
    expect(
      (
        await addRecipeToGroceries(
          prisma!,
          {
            recipeId: recipe.id,
            batchId: body.batchIds[0],
            ingredientIds: undefined,
          },
          groceryActor,
          second.id,
        )
      ).status,
    ).toBe(409);
  });
});
