/** Authored/unrun: opt-in disposable PostgreSQL, no provider or canonical writes by preview. */
import { randomUUID } from "node:crypto";
import { assertFixtureTargetAllowed } from "../../fixtures/guard";
import { defaultFeatures } from "../../features";
import { previewFoodPlan, foodPreviewRequest } from "../server";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(60000);
suite("food planning scoped canonical reads", () => {
  let db: NonNullable<typeof import("../../prisma").prisma>;
  const family = `food-plan-${randomUUID()}`,
    otherFamily = `food-plan-other-${randomUUID()}`;
  const user = `food-plan-${randomUUID()}`,
    otherUser = `food-plan-other-${randomUUID()}`;
  const actor = {
    userId: user,
    familyId: family,
    role: "parent",
    generation: 0,
  };
  const now = new Date("2026-10-22T12:00:00Z");
  const previous = process.env.FAMILY_FOOD_PLANNING_READY;
  let recipeA: string,
    recipeB: string,
    foreignRecipe: string,
    ingredientA: string;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = (await import("../../prisma")).prisma!;
    for (const [id, userId] of [
      [family, user],
      [otherFamily, otherUser],
    ]) {
      await db.family.create({
        data: {
          id,
          name: "Synthetic food planner",
          invite_code: id,
          features: { ...defaultFeatures(), meals: true, inventory: true },
        },
      });
      await db.user.create({
        data: {
          id: userId,
          family_id: id,
          name: "Synthetic parent",
          email: `${userId}@example.test`,
          role: "parent",
        },
      });
    }
    const ingredient = await db.ingredient.create({
      data: { family_id: family, name: "Rice", unit: "g" },
    });
    ingredientA = ingredient.id;
    const createRecipe = (title: string) =>
      db.recipe.create({
        data: {
          family_id: family,
          created_by: user,
          title,
          servings: 2,
          prep_time: 5,
          cook_time: 15,
          ingredients: {
            create: { ingredient_id: ingredient.id, amount: 100, unit: "g" },
          },
        },
      });
    recipeA = (await createRecipe("Synthetic rice A")).id;
    recipeB = (await createRecipe("Synthetic rice B")).id;
    foreignRecipe = (
      await db.recipe.create({
        data: {
          family_id: otherFamily,
          created_by: otherUser,
          title: "Foreign fixture recipe",
          servings: 2,
        },
      })
    ).id;
    await db.inventoryItem.create({
      data: {
        family_id: family,
        name: "Rice",
        ingredient_id: ingredient.id,
        amount: 150,
        unit: "g",
        status: "active",
      },
    });
    process.env.FAMILY_FOOD_PLANNING_READY = "1";
  });
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(+now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.FAMILY_FOOD_PLANNING_READY;
    else process.env.FAMILY_FOOD_PLANNING_READY = previous;
    if (!db) return;
    await db.family.deleteMany({
      where: { id: { in: [family, otherFamily] } },
    });
    await db.user.deleteMany({ where: { id: { in: [user, otherUser] } } });
    await db.$disconnect();
  });
  const query = () =>
    foodPreviewRequest.parse({
      recipeIds: [recipeA, recipeB],
      plan: {
        timeZone: "UTC",
        slots: [
          {
            key: "first",
            date: "2026-10-22",
            mealType: "dinner",
            servings: 2,
            recipeId: recipeA,
          },
          {
            key: "second",
            date: "2026-10-23",
            mealType: "dinner",
            servings: 2,
            recipeId: recipeB,
          },
        ],
      },
    });
  it("plans against owned stock without mutating stock, meals or activity, then preserves an occupied canonical slot", async () => {
    const result = await previewFoodPlan(db, actor, query(), now);
    expect(result.plan.slots[0].choice!.ingredients[0].state).toBe("covered");
    expect(result.plan.slots[1].choice!.ingredients[0].shortfall).toBe(50);
    expect(JSON.stringify(result)).not.toContain("Foreign fixture recipe");
    expect(
      (await db.inventoryItem.findFirst({ where: { family_id: family } }))!
        .amount,
    ).toBe(150);
    expect(await db.familyMeal.count({ where: { family_id: family } })).toBe(0);
    expect(await db.activity.count({ where: { family_id: family } })).toBe(0);
    await db.familyMeal.create({
      data: {
        family_id: family,
        created_by: user,
        date: new Date("2026-10-23T00:00:00Z"),
        meal_type: "dinner",
        recipe_id: recipeB,
      },
    });
    const occupied = await previewFoodPlan(db, actor, query(), now);
    expect(occupied.plan.slots[1]).toMatchObject({
      choice: null,
      holds: ["slot-occupied"],
    });
    expect(occupied.snapshotRevision).not.toBe(result.snapshotRevision);
    expect(await db.familyMeal.count({ where: { family_id: family } })).toBe(1);
  });
  it("does not resolve a foreign selected recipe or a replaced session generation", async () => {
    await expect(
      previewFoodPlan(
        db,
        actor,
        { ...query(), recipeIds: [foreignRecipe] },
        now,
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await db.user.update({ where: { id: user }, data: { token_version: 1 } });
    try {
      await expect(
        previewFoodPlan(db, actor, query(), now),
      ).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    } finally {
      await db.user.update({ where: { id: user }, data: { token_version: 0 } });
    }
  });
  it("counts an unprepared whole dish once, then uses explicit prepared/eaten/cancelled states without consuming inventory again", async () => {
    const session = await db.mealPrepSession.create({
      data: {
        family_id: family,
        created_by: user,
        prepared_on: new Date("2026-10-22T00:00:00Z"),
        next_prep_on: new Date("2026-10-28T00:00:00Z"),
      },
    });
    const batch = await db.mealBatch.create({
      data: {
        family_id: family,
        prep_session_id: session.id,
        position: 0,
        name: "Synthetic pending dish",
        total_servings: 6,
        reserve_storage: "freezer",
        recipe_id: recipeA,
      },
    });
    const allocation = await db.familyMeal.create({
      data: {
        family_id: family,
        created_by: user,
        date: new Date("2026-10-24T00:00:00Z"),
        meal_type: "dinner",
        recipe_id: recipeA,
        batch_id: batch.id,
        servings: 2,
      },
    });
    await db.familyMeal.create({
      data: {
        family_id: family,
        created_by: user,
        date: new Date("2026-10-25T00:00:00Z"),
        meal_type: "dinner",
        recipe_id: recipeA,
        batch_id: batch.id,
        servings: 2,
      },
    });
    const pending = await previewFoodPlan(db, actor, query(), now);
    const commitment = pending.plan.commitments.entries.filter(
      (row) => row.id === `batch:${batch.id}`,
    );
    expect(commitment).toHaveLength(1);
    expect(commitment[0].servings).toBe(6);
    expect(pending.plan.slots[0].choice!.ingredients[0].recordedAvailable).toBe(
      0,
    );
    await db.mealPrepSession.update({
      where: { id: session.id },
      data: { prepared_at: now },
    });
    const eaten = await db.mealBatchConsumption.create({
      data: {
        family_id: family,
        batch_id: batch.id,
        meal_id: allocation.id,
        servings: 1,
        created_by: user,
      },
    });
    const ready = await previewFoodPlan(db, actor, query(), now);
    expect(
      ready.plan.commitments.entries.some(
        (row) => row.id === `batch:${batch.id}`,
      ),
    ).toBe(false);
    expect(
      ready.plan.commitments.prepared.find((row) => row.batchId === batch.id),
    ).toMatchObject({
      total: 6,
      eaten: 1,
      planned: 3,
      remaining: 5,
      unplanned: 2,
      nextPrepOn: "2026-10-28",
      recipeHistoryRecorded: false,
    });
    await db.mealBatchConsumption.update({
      where: { id: eaten.id },
      data: { cancelled_at: now },
    });
    const undone = await previewFoodPlan(db, actor, query(), now);
    expect(
      undone.plan.commitments.prepared.find((row) => row.batchId === batch.id),
    ).toMatchObject({ eaten: 0, planned: 4, remaining: 6, unplanned: 2 });
    expect(
      (await db.inventoryItem.findFirst({ where: { family_id: family } }))!
        .amount,
    ).toBe(150);
    expect(undone.snapshotRevision).not.toBe(ready.snapshotRevision);
  });

  it("refuses a cross-household batch/session graph instead of projecting foreign dish labels", async () => {
    const session = await db.mealPrepSession.create({
      data: {
        family_id: family,
        created_by: user,
        prepared_on: new Date("2026-10-22T00:00:00Z"),
      },
    });
    const foreignBatch = await db.mealBatch.create({
      data: {
        family_id: otherFamily,
        prep_session_id: session.id,
        position: 0,
        name: "Foreign private dish",
        total_servings: 4,
        recipe_id: foreignRecipe,
      },
    });
    try {
      await expect(
        previewFoodPlan(db, actor, query(), now),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally {
      await db.mealBatch.delete({ where: { id: foreignBatch.id } });
      await db.mealPrepSession.delete({ where: { id: session.id } });
    }
  });
  it("uses owned canonical events and material epochs for a departure window, and refuses a foreign departure identity", async () => {
    const busy = await db.event.create({
      data: {
        family_id: family,
        created_by: user,
        title: "Own calendar fixture",
        start_time: new Date("2026-10-22T15:00:00Z"),
        end_time: new Date("2026-10-22T15:30:00Z"),
        event_type: "family",
      },
    });
    const departure = await db.event.create({
      data: {
        family_id: family,
        created_by: user,
        title: "Chosen canonical departure",
        start_time: new Date("2026-10-22T17:00:00Z"),
        end_time: new Date("2026-10-22T18:00:00Z"),
        event_type: "family",
      },
    });
    const foreign = await db.event.create({
      data: {
        family_id: otherFamily,
        created_by: otherUser,
        title: "Foreign calendar fixture",
        start_time: new Date("2026-10-22T15:00:00Z"),
        end_time: new Date("2026-10-22T18:00:00Z"),
        event_type: "family",
      },
    });
    const timed = foodPreviewRequest.parse({
      recipeIds: [recipeA],
      plan: {
        timeZone: "UTC",
        slots: [
          {
            key: "timed",
            date: "2026-10-22",
            mealType: "dinner",
            servings: 2,
            recipeId: recipeA,
            timing: {
              start: "2026-10-22T15:00:00Z",
              end: "2026-10-22T18:00:00Z",
              departureEventId: departure.id,
              beforeCookingMinutes: 5,
              eatingMinutes: 10,
              cleanupMinutes: 5,
              travelMinutes: 30,
              departurePreparationMinutes: 10,
            },
          },
        ],
      },
    });
    const first = await previewFoodPlan(db, actor, timed, now);
    expect(first.plan.calendarChecked).toBe(true);
    expect(first.plan.slots[0].choice!.schedule).toMatchObject({
      state: "fits",
      start: "2026-10-22T15:30:00.000Z",
      finish: "2026-10-22T16:10:00.000Z",
      readyBy: "2026-10-22T16:20:00.000Z",
    });
    expect(JSON.stringify(first)).not.toContain("Foreign calendar fixture");
    await db.event.update({
      where: { id: busy.id },
      data: { end_time: new Date("2026-10-22T16:10:00Z") },
    });
    const blocked = await previewFoodPlan(db, actor, timed, now);
    expect(blocked.plan.slots[0].holds).toContain("calendar-conflict");
    await db.event.update({
      where: { id: busy.id },
      data: { end_time: new Date("2026-10-22T15:30:00Z") },
    });
    const restored = await previewFoodPlan(db, actor, timed, now);
    expect(restored.plan.slots[0].choice!.schedule!.state).toBe("fits");
    expect(restored.snapshotRevision).not.toBe(first.snapshotRevision);
    timed.plan.slots[0].timing!.departureEventId = foreign.id;
    const unavailable = await previewFoodPlan(db, actor, timed, now);
    expect(unavailable.plan.calendar!.reasons).toContain(
      "departure-unavailable",
    );
    expect(unavailable.plan.slots[0].choice!.schedule).toMatchObject({
      state: "unknown",
      departure: null,
    });
  });
  it("changes the source identity after ingredient values return to their original state", async () => {
    const first = await previewFoodPlan(db, actor, query(), now);
    await db.$executeRaw`UPDATE "Ingredient" SET "name"='Synthetic temporary rice' WHERE "id"=${ingredientA}`;
    await db.$executeRaw`UPDATE "Ingredient" SET "name"='Rice' WHERE "id"=${ingredientA}`;
    const restored = await previewFoodPlan(db, actor, query(), now);
    expect(restored.plan).toEqual(first.plan);
    expect(restored.snapshotRevision).not.toBe(first.snapshotRevision);
  });
});
