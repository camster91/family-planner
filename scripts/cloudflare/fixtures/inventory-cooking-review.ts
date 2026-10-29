import type { D1Store } from "../../../src/lib/cloudflare/database";
import { reviewD1CookingStock } from "../../../src/lib/cloudflare/inventory-recovery";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const familyA = "cooking-review-family-a";
const familyB = "cooking-review-family-b";
const parent = {
  userId: "cooking-review-parent",
  familyId: familyA,
  role: "parent",
  generation: 0,
} as const;
const teen = {
  userId: "cooking-review-teen",
  familyId: familyA,
  role: "teen",
  generation: 0,
} as const;
const child = {
  userId: "cooking-review-child",
  familyId: familyA,
  role: "child",
  generation: 0,
} as const;
const foreignParent = {
  userId: "cooking-review-foreign-parent",
  familyId: familyB,
  role: "parent",
  generation: 0,
} as const;

/**
 * Native cooking-review coverage. This stays deliberately read-only: it
 * proves live recipes, immutable prepared-batch history, role/household
 * boundaries, serving overrides, and cross-household ingredient refusal.
 */
export async function testInventoryCookingReview(db: D1Store) {
  const now = Date.parse("2026-10-28T16:00:00.000Z");
  const recipeId = "cooking-review-recipe";
  const ingredientId = "cooking-review-ingredient";
  const lineId = "cooking-review-line";
  const crossRecipeId = "cooking-review-cross-recipe";
  const crossIngredientId = "cooking-review-foreign-ingredient";
  const crossLineId = "cooking-review-cross-line";
  const sessionId = "cooking-review-session";
  const batchId = "cooking-review-batch";
  const snapshot = {
    v: 1 as const,
    recipe: {
      id: recipeId,
      title: "Snapshot dinner",
      description: null,
      instructions: null,
      source_url: null,
      revision: 1,
      servings: 2,
      prep_time: null,
      cook_time: null,
      ingredients: [
        {
          id: lineId,
          amount: 100,
          unit: "g",
          note: null,
          ingredient: {
            id: ingredientId,
            name: "Household rice",
            unit: "g",
          },
        },
      ],
    },
  };
  const features = JSON.stringify({ meals: true, inventory: true });

  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
          (?1,'Cooking review A','cooking-review-code-a',?2),
          (?3,'Cooking review B','cooking-review-code-b',?2)`,
      )
      .bind(familyA, features, familyB),
    db.prepare(
      `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
        ('cooking-review-parent','cooking-review-parent@example.test','Parent','parent',?1,1,0),
        ('cooking-review-teen','cooking-review-teen@example.test','Teen','teen',?1,1,0),
        ('cooking-review-child','cooking-review-child@example.test','Child','child',?1,1,0),
        ('cooking-review-foreign-parent','cooking-review-foreign@example.test','Foreign parent','parent',?2,1,0)`,
    ).bind(familyA, familyB),
    db
      .prepare(
        `INSERT INTO "Ingredient"(id,family_id,name,unit) VALUES
          (?1,?2,'Household rice','g'),
          (?3,?4,'Foreign spice','g')`,
      )
      .bind(ingredientId, familyA, crossIngredientId, familyB),
    db
      .prepare(
        `INSERT INTO "Recipe"(id,family_id,title,servings,revision,created_by) VALUES
          (?1,?2,'Live dinner',2,1,'cooking-review-parent'),
          (?3,?2,'Cross household dinner',2,1,'cooking-review-parent')`,
      )
      .bind(recipeId, familyA, crossRecipeId),
    db
      .prepare(
        `INSERT INTO "RecipeIngredient"(id,recipe_id,ingredient_id,amount,unit) VALUES
          (?1,?2,?3,100,'g'),
          (?4,?5,?6,1,'g')`,
      )
      .bind(lineId, recipeId, ingredientId, crossLineId, crossRecipeId, crossIngredientId),
    db
      .prepare(
        `INSERT INTO "MealPrepSession"(id,family_id,prepared_on,prepared_at,created_by,created_at)
          VALUES (?1,?2,?3,?3,'cooking-review-parent',?3)`,
      )
      .bind(sessionId, familyA, now),
    db
      .prepare(
        `INSERT INTO "MealBatch"(id,family_id,prep_session_id,position,name,total_servings,recipe_id,recipe_snapshot,recipe_snapshot_at,cook_id,created_at)
          VALUES (?1,?2,?3,0,'Prepared dinner',6,?4,?5,?6,'cooking-review-parent',?6)`,
      )
      .bind(
        batchId,
        familyA,
        sessionId,
        recipeId,
        JSON.stringify(snapshot),
        now,
      ),
  ]);

  const before = await db
    .prepare(
      `SELECT title,revision FROM "Recipe" WHERE id=?1 UNION ALL
       SELECT name,0 FROM "MealBatch" WHERE id=?2`,
    )
    .bind(recipeId, batchId)
    .all<{ title: string; revision: number }>();
  const beforeBatch = await db
    .prepare(
      `SELECT recipe_snapshot,recipe_snapshot_at FROM "MealBatch" WHERE id=?1`,
    )
    .bind(batchId)
    .first<{ recipe_snapshot: unknown; recipe_snapshot_at: number }>();

  const live = await reviewD1CookingStock(
    parent,
    { kind: "recipe", id: recipeId, servings: 5 },
    db,
  );
  check(live.status === 200, "parent reviews live recipe");
  check(
    (live.body as any).basis === "current-recipe" &&
      (live.body as any).targetServings === 5,
    "live recipe target servings",
  );

  const teenReview = await reviewD1CookingStock(
    teen,
    { kind: "recipe", id: recipeId },
    db,
  );
  check(teenReview.status === 200, "teen can review cooking stock");
  check(
    (await reviewD1CookingStock(child, { kind: "recipe", id: recipeId }, db))
      .status === 403,
    "child cannot review inventory cooking context",
  );
  check(
    (
      await reviewD1CookingStock(
        foreignParent,
        { kind: "recipe", id: recipeId },
        db,
      )
    ).status === 404,
    "foreign family cannot resolve recipe",
  );

  const prepared = await reviewD1CookingStock(
    parent,
    { kind: "batch", id: batchId },
    db,
  );
  check(prepared.status === 200, "parent reviews prepared batch");
  check(
    (prepared.body as any).basis === "prepared-snapshot" &&
      (prepared.body as any).title === "Snapshot dinner" &&
      (prepared.body as any).targetServings === 6,
    "prepared batch uses immutable snapshot and batch servings",
  );

  check(
    (
      await reviewD1CookingStock(
        parent,
        { kind: "recipe", id: crossRecipeId },
        db,
      )
    ).status === 409,
    "cross-household ingredient is refused",
  );

  const after = await db
    .prepare(
      `SELECT title,revision FROM "Recipe" WHERE id=?1 UNION ALL
       SELECT name,0 FROM "MealBatch" WHERE id=?2`,
    )
    .bind(recipeId, batchId)
    .all<{ title: string; revision: number }>();
  const afterBatch = await db
    .prepare(
      `SELECT recipe_snapshot,recipe_snapshot_at FROM "MealBatch" WHERE id=?1`,
    )
    .bind(batchId)
    .first<{ recipe_snapshot: unknown; recipe_snapshot_at: number }>();
  check(
    JSON.stringify(before.results) === JSON.stringify(after.results) &&
      JSON.stringify(beforeBatch) === JSON.stringify(afterBatch),
    "cooking review is read-only",
  );

  return {
    liveRecipe: true,
    preparedBatchSnapshot: true,
    targetServings: true,
    roleBoundaries: true,
    householdIsolation: true,
    crossHouseholdIngredientRefused: true,
    readOnly: true,
  };
}
