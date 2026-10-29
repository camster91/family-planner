import {
  createD1Recipe,
  deleteD1Recipe,
  mutateD1Collection,
  mutateD1Curation,
  readD1Collections,
  readD1Curation,
  readD1Recipe,
  readD1RecipeReceipt,
  readD1Recipes,
  updateD1Recipe,
} from "../../../src/lib/cloudflare/recipe-library";
import type { D1Store } from "../../../src/lib/cloudflare/database";
import { hashIdempotentRequest } from "../../../src/lib/idempotency-hash";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

const actor = {
  userId: "recipe-library-parent",
  familyId: "recipe-library-a",
  role: "parent",
  generation: 0,
} as const;

/** Fabricated D1 recipe library coverage. No provider calls or credentials. */
export async function testRecipeLibrary(db: D1Store) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO Family(id,name,invite_code,features) VALUES
      ('recipe-library-a','Recipe library A','recipe-library-a-code',?1),
      ('recipe-library-b','Recipe library B','recipe-library-b-code',?1)`,
      )
      .bind(JSON.stringify({ meals: true, lists: true })),
    db.prepare(`INSERT INTO User(id,email,name,role,family_id,email_verified,token_version) VALUES
      ('recipe-library-parent','recipe-library-parent@example.test','Recipe Parent','parent','recipe-library-a',1,0),
      ('recipe-library-teen','recipe-library-teen@example.test','Recipe Teen','teen','recipe-library-a',1,0),
      ('recipe-library-child','recipe-library-child@example.test','Recipe Child','child','recipe-library-a',1,0),
      ('recipe-library-foreign','recipe-library-foreign@example.test','Foreign Parent','parent','recipe-library-b',1,0)`),
    db.prepare(`INSERT INTO Ingredient(id,family_id,name,unit) VALUES
      ('recipe-library-tomato','recipe-library-a','Tomato','g'),
      ('recipe-library-foreign-ingredient','recipe-library-b','Private flour','g')`),
    db.prepare(`INSERT INTO Recipe(id,family_id,title,description,servings,created_by) VALUES
      ('recipe-library-existing','recipe-library-a','Existing soup','House recipe',4,'recipe-library-parent'),
      ('recipe-library-foreign-recipe','recipe-library-b','Private recipe',NULL,2,'recipe-library-foreign')`),
    db.prepare(`INSERT INTO RecipeIngredient(id,recipe_id,ingredient_id,amount,unit) VALUES
      ('recipe-library-existing-line','recipe-library-existing','recipe-library-tomato',2,'g')`),
  ]);

  const page = await readD1Recipes(
    actor,
    { limit: 24, offset: 0, search: {} },
    db,
  );
  check(
    page.status === 200 && (page.body as any).recipes.length === 1,
    "same-household recipe page",
  );
  check(
    (page.body as any).recipes[0]._count.ingredients === 1,
    "recipe ingredient count",
  );

  const input = {
    title: "Weeknight curry",
    description: "A fixture recipe",
    instructions: "Mix and simmer.",
    prep_time: 10,
    cook_time: 20,
    servings: 4,
    source_url:
      "https://example.com/recipes/weeknight-curry?utm_source=fixture",
    ingredients: [
      { name: "  Tomato ", amount: 2, unit: "g" },
      { name: "Coconut milk", amount: 1, unit: "can", note: "unsweetened" },
    ],
  };
  const key = "recipe-library-create-key-01";
  const first = await createD1Recipe(actor, input, key, db);
  check(first.status === 201 && !first.replayed, "recipe create");
  const identity = first.body as { recipeId: string; recipeGeneration: string };
  check(
    identity.recipeId.length > 0 && identity.recipeGeneration.length > 0,
    "recipe receipt identity",
  );
  const replay = await createD1Recipe(actor, input, key, db);
  check(
    replay.status === 201 &&
      replay.replayed &&
      JSON.stringify(replay.body) === JSON.stringify(first.body),
    "recipe create replay",
  );

  const detail = await readD1Recipe(actor, identity.recipeId, db);
  check(
    detail.status === 200 &&
      (detail.body as any).recipe.ingredients.length === 2,
    "recipe detail ingredients",
  );
  check(
    (detail.body as any).recipe.source_url ===
      "https://example.com/recipes/weeknight-curry",
    "canonical source",
  );
  const birth = await db
    .prepare(
      `SELECT food_generation,food_epoch FROM Recipe WHERE id=?1 AND family_id=?2`,
    )
    .bind(identity.recipeId, actor.familyId)
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    birth?.food_generation === identity.recipeGeneration &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        birth.food_generation,
      ) &&
      birth.food_epoch === 0,
    "persisted recipe birth identity",
  );
  const ingredientBirth = await db
    .prepare(
      `SELECT food_generation,food_epoch FROM Ingredient WHERE id=?1 AND family_id=?2`,
    )
    .bind("recipe-library-tomato", actor.familyId)
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    ingredientBirth !== null &&
      Boolean(ingredientBirth.food_generation) &&
      ingredientBirth.food_epoch === 0,
    "persisted ingredient birth identity",
  );
  const lineBirth = await db
    .prepare(
      `SELECT id,food_generation,food_epoch FROM RecipeIngredient WHERE recipe_id=?1 LIMIT 1`,
    )
    .bind(identity.recipeId)
    .first<{ id: string; food_generation: string; food_epoch: number }>();
  check(
    lineBirth !== null &&
      Boolean(lineBirth.food_generation) &&
      lineBirth.food_epoch === 0,
    "persisted recipe ingredient birth identity",
  );
  const ingredientGeneration = ingredientBirth!.food_generation;
  await db
    .prepare(`UPDATE Ingredient SET name=?1 WHERE id=?2`)
    .bind("Tomato diced", "recipe-library-tomato")
    .run();
  const changedIngredient = await db
    .prepare(`SELECT food_generation,food_epoch FROM Ingredient WHERE id=?1`)
    .bind("recipe-library-tomato")
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    changedIngredient?.food_generation === ingredientGeneration &&
      changedIngredient.food_epoch === 1,
    "ingredient update advances epoch without changing generation",
  );
  let ingredientIdentityGuarded = false;
  try {
    await db
      .prepare(`UPDATE Ingredient SET food_generation=?1 WHERE id=?2`)
      .bind("00000000-0000-4000-8000-000000000000", "recipe-library-tomato")
      .run();
  } catch {
    ingredientIdentityGuarded = true;
  }
  check(ingredientIdentityGuarded, "ingredient identity cannot be rewritten");
  const lineGeneration = lineBirth!.food_generation;
  await db
    .prepare(`UPDATE RecipeIngredient SET amount=?1 WHERE id=?2`)
    .bind(3, lineBirth!.id)
    .run();
  const changedLine = await db
    .prepare(
      `SELECT food_generation,food_epoch FROM RecipeIngredient WHERE id=?1`,
    )
    .bind(lineBirth!.id)
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    changedLine?.food_generation === lineGeneration &&
      changedLine.food_epoch === 1,
    "recipe ingredient update advances epoch without changing generation",
  );
  let lineIdentityGuarded = false;
  try {
    await db
      .prepare(`UPDATE RecipeIngredient SET food_generation=?1 WHERE id=?2`)
      .bind("00000000-0000-4000-8000-000000000000", lineBirth!.id)
      .run();
  } catch {
    lineIdentityGuarded = true;
  }
  check(lineIdentityGuarded, "recipe ingredient identity cannot be rewritten");

  const receipt = await readD1RecipeReceipt(
    actor,
    key,
    hashIdempotentRequest("recipe.create", input),
    db,
  );
  check(
    receipt.status === 200 &&
      (receipt.body as any).state === "committed" &&
      (receipt.body as any).current === "present",
    "recipe receipt state",
  );

  const duplicate = await createD1Recipe(
    actor,
    input,
    "recipe-library-duplicate-key",
    db,
  );
  check(
    duplicate.status === 409 &&
      (duplicate.body as any).error.code === "RECIPE_SOURCE_EXISTS",
    "source duplicate refusal",
  );
  const copied = await createD1Recipe(
    actor,
    { ...input, source_copy: true, title: "Copied curry" },
    "recipe-library-copy-key-01",
    db,
  );
  check(copied.status === 201, "explicit source copy");
  const copiedIdentity = copied.body as {
    recipeId: string;
    recipeGeneration: string;
  };
  const copiedBirth = await db
    .prepare(`SELECT food_generation FROM Recipe WHERE id=?1`)
    .bind(copiedIdentity.recipeId)
    .first<{ food_generation: string }>();
  check(
    copiedBirth?.food_generation === copiedIdentity.recipeGeneration &&
      copiedBirth.food_generation !== birth.food_generation,
    "copy receives independent birth identity",
  );

  const lines = (detail.body as any).recipe.ingredients;
  const updated = await updateD1Recipe(
    actor,
    identity.recipeId,
    {
      title: "Weeknight curry updated",
      base_revision: 0,
      ingredients: [
        { ingredient_id: lines[0].ingredient.id, amount: 3, unit: "g" },
      ],
    },
    db,
  );
  check(updated.status === 200, "recipe metadata and line replacement");
  const changed = await readD1Recipe(actor, identity.recipeId, db);
  check(
    changed.status === 200 &&
      (changed.body as any).recipe.title === "Weeknight curry updated" &&
      (changed.body as any).recipe.ingredients.length === 1,
    "recipe readback",
  );
  const afterUpdate = await db
    .prepare(
      `SELECT food_generation,food_epoch FROM Recipe WHERE id=?1 AND family_id=?2`,
    )
    .bind(identity.recipeId, actor.familyId)
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    afterUpdate?.food_generation === birth.food_generation &&
      afterUpdate.food_epoch > birth.food_epoch,
    "recipe update advances epoch without changing generation",
  );
  let identityGuarded = false;
  try {
    await db
      .prepare(`UPDATE Recipe SET food_generation=?1 WHERE id=?2`)
      .bind("00000000-0000-4000-8000-000000000000", identity.recipeId)
      .run();
  } catch {
    identityGuarded = true;
  }
  check(identityGuarded, "recipe identity cannot be rewritten");
  let epochGuarded = false;
  try {
    await db
      .prepare(`UPDATE Recipe SET food_epoch=0 WHERE id=?1`)
      .bind(identity.recipeId)
      .run();
  } catch {
    epochGuarded = true;
  }
  check(epochGuarded, "recipe epoch cannot move backwards");
  let forwardEpochGuarded = false;
  try {
    await db
      .prepare(`UPDATE Recipe SET food_epoch=food_epoch+1 WHERE id=?1`)
      .bind(identity.recipeId)
      .run();
  } catch {
    forwardEpochGuarded = true;
  }
  check(forwardEpochGuarded, "recipe epoch cannot be supplied by a writer");
  const conflict = await updateD1Recipe(
    actor,
    identity.recipeId,
    { base_revision: 0, title: "stale" },
    db,
  );
  check(conflict.status === 409, "recipe revision conflict");

  const collection = await mutateD1Collection(
    actor,
    { action: "create", name: "Weeknight" },
    db,
  );
  check(collection.status === 201, "collection create");
  const collectionId = (collection.body as any).collection.id as string;
  const curated = await mutateD1Curation(
    actor,
    identity.recipeId,
    { revision: 1, favorite: true, collectionIds: [collectionId] },
    db,
  );
  check(
    curated.status === 200 && (curated.body as any).favorite === true,
    "favorite and collection save",
  );
  const curation = await readD1Curation(actor, identity.recipeId, db);
  check(
    curation.status === 200 &&
      (curation.body as any).collectionIds.includes(collectionId),
    "curation readback",
  );
  const collections = await readD1Collections(actor, db);
  check(
    collections.status === 200 &&
      (collections.body as any).collections.length === 1,
    "collection list",
  );

  const foreign = await readD1Recipe(
    {
      ...actor,
      userId: "recipe-library-foreign",
      familyId: "recipe-library-b",
      role: "parent",
    },
    identity.recipeId,
    db,
  );
  check(foreign.status === 404, "foreign recipe isolation");
  const childWrite = await createD1Recipe(
    { ...actor, userId: "recipe-library-child", role: "child" },
    { title: "Child attempt" },
    null,
    db,
  );
  check(childWrite.status === 403, "child write gate");
  const copiedDeleted = await deleteD1Recipe(
    actor,
    copiedIdentity.recipeId,
    db,
  );
  check(copiedDeleted.status === 200, "copied recipe delete");
  const deleted = await deleteD1Recipe(actor, identity.recipeId, db);
  check(deleted.status === 200, "recipe delete");
  check(
    (await readD1Recipe(actor, identity.recipeId, db)).status === 404,
    "deleted recipe unavailable",
  );
  const removedReceipt = await readD1RecipeReceipt(
    actor,
    key,
    hashIdempotentRequest("recipe.create", input),
    db,
  );
  check(
    removedReceipt.status === 200 &&
      (removedReceipt.body as any).state === "committed" &&
      (removedReceipt.body as any).current === "removed",
    "receipt detects stale deleted recipe",
  );
  const recreated = await createD1Recipe(
    actor,
    input,
    "recipe-library-recreate-key",
    db,
  );
  check(
    recreated.status === 201 && !recreated.replayed,
    "deleted recipe can be recreated",
  );
  const recreatedIdentity = recreated.body as {
    recipeId: string;
    recipeGeneration: string;
  };
  const recreatedBirth = await db
    .prepare(`SELECT food_generation FROM Recipe WHERE id=?1`)
    .bind(recreatedIdentity.recipeId)
    .first<{ food_generation: string }>();
  check(
    recreatedBirth?.food_generation === recreatedIdentity.recipeGeneration &&
      recreatedBirth.food_generation !== birth.food_generation,
    "recreated recipe receives a new birth identity",
  );
  check(
    (await deleteD1Recipe(actor, recreatedIdentity.recipeId, db)).status ===
      200,
    "recreated recipe cleanup",
  );
  const rollbackInput = {
    title: "Rollback recipe",
    ingredients: [{ name: "Rollback salt", amount: 1 }],
  };
  const failingDb: D1Store = {
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession("first-primary");
      return {
        prepare: session.prepare.bind(session),
        async batch() {
          throw new Error("fixture effect rollback");
        },
      };
    },
  };
  let rolledBack = false;
  try {
    await createD1Recipe(
      actor,
      rollbackInput,
      "recipe-library-rollback-key",
      failingDb,
    );
  } catch {
    rolledBack = true;
  }
  check(rolledBack, "effect failure is surfaced");
  check(
    (
      await db
        .prepare(
          `SELECT count(*) AS n FROM Recipe WHERE family_id=?1 AND title=?2`,
        )
        .bind(actor.familyId, rollbackInput.title)
        .first<{ n: number }>()
    )?.n === 0 &&
      (
        await db
          .prepare(
            `SELECT count(*) AS n FROM Ingredient WHERE family_id=?1 AND name=?2`,
          )
          .bind(actor.familyId, "Rollback salt")
          .first<{ n: number }>()
      )?.n === 0,
    "failed recipe effect rolls back recipe and ingredient",
  );
  return {
    read: true,
    isolation: true,
    create: true,
    replay: true,
    sourceDeduplication: true,
    sourceCopy: true,
    ingredientEditing: true,
    revisionConflict: true,
    favorites: true,
    collections: true,
    receipt: true,
    delete: true,
    foodBirthIdentity: true,
    foodEpoch: true,
    staleWriteGuards: true,
    deleteRecreate: true,
    rollback: true,
  };
}
