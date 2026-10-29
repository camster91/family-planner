import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  applyD1FoodPlan,
  previewD1FoodPlan,
  reviewD1FoodPlanWrite,
} from "../../../src/lib/cloudflare/food-planning";
import {
  readD1FoodGroceryOutcomes,
  undoD1FoodGroceryAdd,
} from "../../../src/lib/cloudflare/food-recovery";
import {
  foodApplyReceipt,
  foodApplyReceiptMatches,
  reviewedFoodWrite,
} from "../../../src/lib/food-planning/apply-contract";
import { foodPreviewRequest } from "../../../src/lib/food-planning/contract";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/**
 * Native food planning end-to-end fixture. It exercises the D1 preview lease,
 * reviewed apply, root replay, canonical child grocery outcome and exact undo
 * without provider calls or real household data.
 */
export async function testFoodPlanning(db: D1Store) {
  const now = new Date();
  const date = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const familyId = "food-native-family";
  const userId = "food-native-parent";
  const recipeId = "food-native-recipe";
  const ingredientId = "food-native-ingredient";
  const lineId = "food-native-recipe-line";
  const listId = "food-native-list";
  const foreignFamilyId = "food-native-foreign-family";
  const foreignUserId = "food-native-foreign-parent";
  const foreignIngredientId = "food-native-foreign-ingredient";
  const foreignRecipeId = "food-native-foreign-recipe";
  const invalidRecipeId = "food-native-invalid-recipe";
  const invalidLineId = "food-native-invalid-line";
  const dependencySessionId = "food-native-invalid-session";
  const dependencyBatchId = "food-native-invalid-batch";
  const actor = {
    userId,
    familyId,
    role: "parent",
    generation: 0,
  } as const;
  const previousReady = process.env.FAMILY_FOOD_PLANNING_READY;
  process.env.FAMILY_FOOD_PLANNING_READY = "1";
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO "Family"(id,name,invite_code,features) VALUES (?1,?2,?3,?4)`,
        )
        .bind(
          familyId,
          "Native food fixture",
          "food-native-invite",
          JSON.stringify({ meals: true, inventory: true, lists: true }),
        ),
      db
        .prepare(
          `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES (?1,?2,?3,'parent',?4,1,0)`,
        )
        .bind(
          userId,
          "food-native-parent@example.test",
          "Native Parent",
          familyId,
        ),
      db
        .prepare(
          `INSERT INTO "Family"(id,name,invite_code,features) VALUES (?1,?2,?3,?4)`,
        )
        .bind(
          foreignFamilyId,
          "Foreign food fixture",
          "food-native-foreign-invite",
          JSON.stringify({ meals: true, inventory: true, lists: true }),
        ),
      db
        .prepare(
          `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES (?1,?2,?3,'parent',?4,1,0)`,
        )
        .bind(
          foreignUserId,
          "food-native-foreign-parent@example.test",
          "Foreign Parent",
          foreignFamilyId,
        ),
      db
        .prepare(
          `INSERT INTO "Ingredient"(id,family_id,name,unit) VALUES (?1,?2,?3,?4)`,
        )
        .bind(ingredientId, familyId, "Fixture rice", "g"),
      db
        .prepare(
          `INSERT INTO "Recipe"(id,family_id,title,servings,prep_time,cook_time,created_by) VALUES (?1,?2,?3,2,5,15,?4)`,
        )
        .bind(recipeId, familyId, "Fixture rice", userId),
      db
        .prepare(
          `INSERT INTO "RecipeIngredient"(id,recipe_id,ingredient_id,amount,unit) VALUES (?1,?2,?3,100,'g')`,
        )
        .bind(lineId, recipeId, ingredientId),
      db
        .prepare(
          `INSERT INTO "Ingredient"(id,family_id,name,unit) VALUES (?1,?2,?3,?4)`,
        )
        .bind(foreignIngredientId, foreignFamilyId, "Private foreign ingredient", "g"),
      db
        .prepare(
          `INSERT INTO "Recipe"(id,family_id,title,servings,prep_time,cook_time,created_by) VALUES (?1,?2,?3,2,5,15,?4), (?5,?6,?7,2,5,15,?8)`,
        )
        .bind(
          invalidRecipeId,
          familyId,
          "Invalid foreign-linked recipe",
          userId,
          foreignRecipeId,
          foreignFamilyId,
          "Foreign recipe dependency",
          foreignUserId,
        ),
      db
        .prepare(
          `INSERT INTO "RecipeIngredient"(id,recipe_id,ingredient_id,amount,unit) VALUES (?1,?2,?3,100,'g')`,
        )
        .bind(invalidLineId, invalidRecipeId, foreignIngredientId),
      db
        .prepare(
          `INSERT INTO "List"(id,family_id,name,type,created_by) VALUES (?1,?2,?3,'grocery',?4)`,
        )
        .bind(listId, familyId, "Fixture groceries", userId),
    ]);

    const sourceRequest = foodPreviewRequest.parse({
      plan: {
        timeZone: "UTC",
        slots: [
          {
            key: "food-native-slot",
            date,
            mealType: "dinner",
            servings: 2,
            recipeId,
          },
        ],
      },
      recipeIds: [recipeId],
    });
    const preview = await previewD1FoodPlan(db, actor, sourceRequest, now);
    check(
      preview.plan.slots[0]?.choice?.recipeId === recipeId,
      "native food preview",
    );

    let missingRecipeRefused = false;
    try {
      await previewD1FoodPlan(
        db,
        actor,
        foodPreviewRequest.parse({
          plan: {
            ...sourceRequest.plan,
            slots: [
              {
                ...sourceRequest.plan.slots[0]!,
                key: "food-native-missing-recipe-slot",
                recipeId: "food-native-missing-recipe",
              },
            ],
          },
          recipeIds: ["food-native-missing-recipe"],
        }),
        now,
      );
    } catch {
      missingRecipeRefused = true;
    }
    check(missingRecipeRefused, "missing recipe refused");

    let foreignIngredientRefused = false;
    try {
      await previewD1FoodPlan(
        db,
        actor,
        foodPreviewRequest.parse({
          plan: {
            ...sourceRequest.plan,
            slots: [
              {
                ...sourceRequest.plan.slots[0]!,
                key: "food-native-foreign-ingredient-slot",
                recipeId: invalidRecipeId,
              },
            ],
          },
          recipeIds: [invalidRecipeId],
        }),
        now,
      );
    } catch {
      foreignIngredientRefused = true;
    }
    check(foreignIngredientRefused, "foreign recipe ingredient refused");

    const review = await reviewD1FoodPlanWrite(
      db,
      actor,
      {
        sourceRequest,
        protocol: "herewoven.food-apply.v1",
        mode: "meals",
        reviewProof: "pending-server-review",
        meals: [
          {
            key: "food-native-slot",
            input: {
              protocol: "herewoven.meal-create.v1",
              expected_user_id: userId,
              expected_family_id: familyId,
              issued_at: now.toISOString(),
              date,
              meal_type: "dinner",
              recipe_id: recipeId,
              servings: 2,
            },
          },
        ],
        groceries: [
          {
            key: "food-native-slot",
            listId,
            ingredientIds: [ingredientId],
          },
        ],
      },
      now,
    );
    const command = reviewedFoodWrite.parse(review.input);
    const saved = await applyD1FoodPlan(
      db,
      actor,
      command,
      "food-native-apply-key",
    );
    check(
      saved.status === 201 &&
        foodApplyReceipt.safeParse(saved.body).success &&
        foodApplyReceiptMatches(saved.body, command),
      "native food apply receipt",
    );
    const replay = await applyD1FoodPlan(
      db,
      actor,
      command,
      "food-native-apply-key",
    );
    check(replay.replayed && replay.status === 201, "native food root replay");

    const receipt = foodApplyReceipt.parse(saved.body);
    const outcomes = await readD1FoodGroceryOutcomes(
      db,
      actor,
      {
        kind: "food-plan",
        key: "food-native-apply-key",
        body: JSON.stringify(command),
      },
      "a".repeat(64),
    );
    check(
      outcomes.outcomes[0]?.result?.createdCount === 1,
      "native grocery child outcome",
    );
    const undone = await undoD1FoodGroceryAdd(
      db,
      actor,
      {
        kind: "food-plan",
        key: "food-native-apply-key",
        body: JSON.stringify(command),
      },
      receipt.groceries[0]!.requestId,
      "a".repeat(64),
    );
    check(
      undone.result.kind === "done" && undone.result.removedCount === 1,
      "native grocery undo",
    );

    await db.batch([
      db
        .prepare(
          `INSERT INTO "MealPrepSession"(id,family_id,prepared_on,created_by,created_at) VALUES (?1,?2,?3,?4,?3)`,
        )
        .bind(
          dependencySessionId,
          familyId,
          now.getTime() - 86400000,
          userId,
        ),
      db
        .prepare(
          `INSERT INTO "MealBatch"(id,family_id,prep_session_id,position,name,total_servings,reserve_storage,recipe_id,cook_id,created_at) VALUES (?1,?2,?3,0,?4,2,'freezer',?5,?6,?7)`,
        )
        .bind(
          dependencyBatchId,
          familyId,
          dependencySessionId,
          "Foreign dependency batch",
          foreignRecipeId,
          userId,
          now.getTime(),
        ),
    ]);
    let foreignDependencyRefused = false;
    try {
      await previewD1FoodPlan(db, actor, sourceRequest, now);
    } catch {
      foreignDependencyRefused = true;
    }
    check(foreignDependencyRefused, "foreign dependency recipe refused");

    return {
      preview: true,
      missingRecipeRefused,
      foreignIngredientRefused,
      foreignDependencyRefused,
      review: true,
      apply: true,
      replay: true,
      outcomes: true,
      undo: true,
    };
  } finally {
    if (previousReady === undefined)
      delete process.env.FAMILY_FOOD_PLANNING_READY;
    else process.env.FAMILY_FOOD_PLANNING_READY = previousReady;
  }
}
