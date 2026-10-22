/** Authored/unrun. Disposable migrated PostgreSQL only, never production.
 * Verifies legacy SQL writes without relying on new ORM writer adoption. */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertFixtureTargetAllowed } from "../../fixtures/guard";
import {
  FOOD_SOURCE_KINDS,
  foodSourceStorageAvailable,
  readFoodSourceVersions,
  type FoodSourceSelection,
} from "../source-versions";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(60000);
suite("food row continuity across legacy writers", () => {
  let db: NonNullable<typeof import("../../prisma").prisma>;
  const familyId = `food-version-${randomUUID()}`,
    otherFamilyId = `food-version-other-${randomUUID()}`;
  const personId = `${familyId}-parent`;
  let selected: FoodSourceSelection;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = (await import("../../prisma")).prisma!;
    await db.family.create({
      data: { id: familyId, name: "Synthetic versions" },
    });
    await db.family.create({
      data: { id: otherFamilyId, name: "Synthetic other versions" },
    });
    await db.user.create({
      data: {
        id: personId,
        family_id: familyId,
        name: "Synthetic parent",
        email: `${personId}@example.invalid`,
        role: "parent",
      },
    });
    const ingredient = await db.ingredient.create({
      data: { family_id: familyId, name: "Synthetic rice", unit: "g" },
    });
    const recipe = await db.recipe.create({
      data: {
        family_id: familyId,
        title: "Synthetic recipe",
        created_by: personId,
      },
    });
    const line = await db.recipeIngredient.create({
      data: {
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        amount: 100,
        unit: "g",
      },
    });
    const stock = await db.inventoryItem.create({
      data: {
        family_id: familyId,
        name: "Synthetic stock",
        ingredient_id: ingredient.id,
        amount: 100,
        unit: "g",
      },
    });
    const session = await db.mealPrepSession.create({
      data: {
        family_id: familyId,
        created_by: personId,
        prepared_on: new Date("2026-10-22T00:00:00Z"),
      },
    });
    const batch = await db.mealBatch.create({
      data: {
        family_id: familyId,
        prep_session_id: session.id,
        name: "Synthetic dish",
        position: 0,
        total_servings: 4,
        reserve_storage: "fridge",
        recipe_id: recipe.id,
      },
    });
    const meal = await db.familyMeal.create({
      data: {
        family_id: familyId,
        created_by: personId,
        date: new Date("2026-10-23T00:00:00Z"),
        meal_type: "dinner",
        recipe_id: recipe.id,
        batch_id: batch.id,
        servings: 2,
      },
    });
    const consumption = await db.mealBatchConsumption.create({
      data: {
        family_id: familyId,
        batch_id: batch.id,
        meal_id: meal.id,
        servings: 1,
        created_by: personId,
      },
    });
    const list = await db.list.create({
      data: {
        family_id: familyId,
        created_by: personId,
        name: "Synthetic list",
        type: "grocery",
      },
    });
    selected = {
      Family: [familyId],
      User: [personId],
      Recipe: [recipe.id],
      RecipeIngredient: [line.id],
      Ingredient: [ingredient.id],
      InventoryItem: [stock.id],
      FamilyMeal: [meal.id],
      MealPrepSession: [session.id],
      MealBatch: [batch.id],
      MealBatchConsumption: [consumption.id],
      List: [list.id],
    };
  });
  afterAll(async () => {
    if (!db) return;
    await db.family.deleteMany({
      where: { id: { in: [familyId, otherFamilyId] } },
    });
    await db.user.deleteMany({ where: { id: personId } });
    await db.$disconnect();
  });
  const read = () =>
    db.$transaction((tx) => readFoodSourceVersions(tx, familyId, selected), {
      isolationLevel: "RepeatableRead",
    });
  it("requires all eleven source kinds and ignores forged resets on raw legacy updates", async () => {
    expect(await foodSourceStorageAvailable(db)).toBe(true);
    const before = await read();
    expect(before).toHaveLength(11);
    for (const kind of FOOD_SOURCE_KINDS) {
      const table = Prisma.raw(`public."${kind}"`);
      await db.$executeRaw(
        Prisma.sql`UPDATE ${table} SET "food_epoch"=0, "food_generation"=${randomUUID()} WHERE "id"=${selected[kind]![0]}`,
      );
    }
    const after = await read();
    for (const old of before)
      expect(after.find((row) => row.kind === old.kind)).toMatchObject({
        id: old.id,
        generation: old.generation,
        epoch: old.epoch + 1,
      });
  });
  it("detects name-away-and-back without relying on an updated_at column", async () => {
    const before = (await read()).find((row) => row.kind === "Ingredient")!;
    const ingredientId = selected.Ingredient![0];
    await db.$executeRaw`UPDATE "Ingredient" SET "name"='Synthetic temporary name' WHERE "id"=${ingredientId}`;
    await db.$executeRaw`UPDATE "Ingredient" SET "name"='Synthetic rice' WHERE "id"=${ingredientId}`;
    expect((await read()).find((row) => row.kind === "Ingredient")).toEqual({
      ...before,
      epoch: before.epoch + 2,
    });
  });
  it("assigns fresh insertion identity even when a recreated ID supplies the old generation", async () => {
    const id = `${familyId}-recreated`,
      oldGeneration = randomUUID();
    await db.$executeRaw`INSERT INTO "Ingredient" ("id","family_id","name","food_generation","food_epoch") VALUES (${id},${familyId},'Synthetic recreated',${oldGeneration},123)`;
    const first = await readFoodSourceVersions(db, familyId, {
      Ingredient: [id],
    });
    expect(first[0].generation).not.toBe(oldGeneration);
    expect(first[0].epoch).toBe(0);
    await db.ingredient.delete({ where: { id } });
    await db.$executeRaw`INSERT INTO "Ingredient" ("id","family_id","name","food_generation","food_epoch") VALUES (${id},${familyId},'Synthetic recreated',${first[0].generation},${first[0].epoch})`;
    expect(
      (await readFoodSourceVersions(db, familyId, { Ingredient: [id] }))[0]
        .generation,
    ).not.toBe(first[0].generation);
  });
  it("does not disclose metadata for another household or a cross-family recipe ingredient", async () => {
    await expect(
      readFoodSourceVersions(db, otherFamilyId, { User: [personId] }),
    ).rejects.toThrow();
    const foreign = await db.ingredient.create({
      data: { family_id: otherFamilyId, name: "Foreign synthetic ingredient" },
    });
    const line = await db.recipeIngredient.create({
      data: {
        recipe_id: selected.Recipe![0],
        ingredient_id: foreign.id,
        amount: 1,
      },
    });
    await expect(
      readFoodSourceVersions(db, familyId, { RecipeIngredient: [line.id] }),
    ).rejects.toThrow();
    await db.recipeIngredient.delete({ where: { id: line.id } });
  });
  it("refuses overflow rather than freezing or wrapping an exhausted version", async () => {
    await expect(
      db.$transaction(async (tx) => {
        // Temporary private row: never disable triggers on shared fixture tables.
        await tx.$executeRawUnsafe(
          "CREATE TEMP TABLE food_version_exhausted (id text, food_generation text, food_epoch integer) ON COMMIT DROP",
        );
        await tx.$executeRaw`INSERT INTO food_version_exhausted VALUES ('fixture', ${randomUUID()}, 2147483646)`;
        await tx.$executeRawUnsafe(
          "CREATE TRIGGER food_version_exhausted BEFORE UPDATE ON food_version_exhausted FOR EACH ROW EXECUTE FUNCTION public.herewoven_food_source_version()",
        );
        await tx.$executeRawUnsafe(
          "UPDATE food_version_exhausted SET id = 'fixture'",
        );
      }),
    ).rejects.toThrow();
  });
});
