/** Source for the later consolidated run, against an explicitly disposable DB. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { persistMealPrepInTx } from "@/lib/meal-batch-api";
import { createMealPrepSchema, type MealPrepAction } from "@/lib/meal-batches";
import { mealRecipeSnapshot } from "@/lib/meal-recipe-history-contract";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("recipe evidence at prep completion", () => {
  const familyId = `fx_history_${crypto.randomUUID()}`;
  const userId = `${familyId}_parent`;
  const actor = { familyId, userId, tokenVersion: 0 };
  const context = { expected_family_id: familyId, expected_user_id: userId };
  async function persist(
    input: ReturnType<typeof createMealPrepSchema.parse> | MealPrepAction,
  ) {
    const receipt = await prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: "meal-prep.history-fixture",
        request_hash: "fixture",
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    return prisma!.$transaction((tx) =>
      persistMealPrepInTx(tx, actor, input, receipt.id),
    );
  }
  async function prepare(sessionId: string) {
    return persist({ ...context, action: "prepared", session_id: sessionId });
  }
  async function recipe(title = "Original soup") {
    return prisma!.recipe.create({
      data: {
        family_id: familyId,
        created_by: userId,
        title,
        instructions: "Simmer gently.",
        servings: 4,
        revision: 3,
        source_url: "https://recipes.example.test/soup?utm_source=fixture",
        ingredients: {
          create: {
            amount: 2,
            unit: "cups",
            ingredient: {
              create: {
                family_id: familyId,
                name: `Beans ${crypto.randomUUID()}`,
                unit: "cups",
              },
            },
          },
        },
      },
    });
  }
  async function plan(recipeIds: string[]) {
    const response = await persist(
      createMealPrepSchema.parse({
        ...context,
        prepared_on: "2026-10-19",
        next_prep_on: null,
        dishes: recipeIds.map((recipe_id) => ({
          name: "Soup",
          recipe_id,
          total_servings: 8,
          reserve_storage: "freezer",
          meals: [],
        })),
      }),
    );
    expect(response.status).toBe(201);
    return response.body as { sessionId: string; batchIds: string[] };
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.create({
      data: {
        id: familyId,
        name: "Recipe history fixture",
        features: { meals: true },
      },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        name: "Fixture parent",
        email: `${userId}@example.invalid`,
        email_verified: true,
      },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: familyId } });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("freezes recipe and ingredient details and never recaptures on later prep requests", async () => {
    const source = await recipe();
    const p = await plan([source.id]);
    expect((await prepare(p.sessionId)).status).toBe(200);
    const saved = await prisma!.mealBatch.findUniqueOrThrow({
      where: { id: p.batchIds[0] },
    });
    const snapshot = mealRecipeSnapshot.parse(saved.recipe_snapshot);
    expect(snapshot.recipe).toMatchObject({
      title: "Original soup",
      revision: 3,
      instructions: "Simmer gently.",
      source_url: "https://recipes.example.test/soup",
    });
    expect(snapshot.recipe.ingredients[0]).toMatchObject({
      amount: 2,
      unit: "cups",
    });
    await prisma!.recipe.update({
      where: { id: source.id },
      data: {
        title: "Changed soup",
        revision: 4,
        instructions: "A different method.",
      },
    });
    await prisma!.recipeIngredient.updateMany({
      where: { recipe_id: source.id },
      data: { amount: 9 },
    });
    expect((await prepare(p.sessionId)).status).toBe(200);
    await prisma!.recipe.delete({ where: { id: source.id } });
    const retained = await prisma!.mealBatch.findUniqueOrThrow({
      where: { id: saved.id },
    });
    expect(retained.recipe_id).toBeNull();
    expect(retained.recipe_snapshot).toEqual(saved.recipe_snapshot);
    expect(retained.recipe_snapshot_at).toEqual(saved.recipe_snapshot_at);
    expect(retained.total_servings).toBe(8);
  });
  it("refuses the entire preparation if a later dish cannot be recorded", async () => {
    const first = await recipe();
    const second = await recipe("Invalid legacy details");
    const p = await plan([first.id, second.id]);
    await prisma!.recipe.update({
      where: { id: second.id },
      data: { instructions: "x".repeat(20001) },
    });
    expect((await prepare(p.sessionId)).status).toBe(409);
    const session = await prisma!.mealPrepSession.findUniqueOrThrow({
      where: { id: p.sessionId },
    });
    expect(session.prepared_at).toBeNull();
    const rows = await prisma!.mealBatch.findMany({
      where: { prep_session_id: p.sessionId },
    });
    expect(
      rows.every(
        (row) =>
          row.recipe_snapshot === null && row.recipe_snapshot_at === null,
      ),
    ).toBe(true);
  });
  it("never invents a snapshot for an already prepared legacy session", async () => {
    const source = await recipe();
    const p = await plan([source.id]);
    await prisma!.mealPrepSession.update({
      where: { id: p.sessionId },
      data: { prepared_at: new Date() },
    });
    expect((await prepare(p.sessionId)).status).toBe(200);
    const row = await prisma!.mealBatch.findUniqueOrThrow({
      where: { id: p.batchIds[0] },
    });
    expect(row.recipe_snapshot).toBeNull();
    expect(row.recipe_snapshot_at).toBeNull();
  });
});
