import {
  addD1GroceryItem,
  addD1RecipeToGroceries,
  readD1RecipeGroceryReview,
  undoD1RecipeAdd,
} from "../../../src/lib/cloudflare/recipe-grocery";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

const actor = {
  userId: "recipe-grocery-parent",
  familyId: "recipe-grocery-a",
  role: "parent",
  generation: 0,
};
const defaultActor = {
  userId: "recipe-grocery-default-parent",
  familyId: "recipe-grocery-default",
  role: "parent",
  generation: 0,
};

/** Native D1 recipe review/add/undo fixture with two-household source proofs. */
export async function testRecipeGrocery(db: D1Store) {
  const now = Date.parse("2026-10-28T16:00:00.000Z");
  await db.batch([
    db
      .prepare(
        `INSERT INTO Family(id,name,invite_code,features) VALUES
        ('recipe-grocery-a','Recipe A','recipe-grocery-code-a',?1),
        ('recipe-grocery-b','Recipe B','recipe-grocery-code-b',?1),
        ('recipe-grocery-default','Recipe Default','recipe-grocery-code-default',?1)`,
      )
      .bind(
        JSON.stringify({
          chores: true,
          calendar: true,
          lists: true,
          family: true,
          meals: true,
          inventory: true,
        }),
      ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id,token_version) VALUES
        ('recipe-grocery-parent','recipe-grocery-parent@example.test','Recipe Parent','parent','recipe-grocery-a',0),
        ('recipe-grocery-child','recipe-grocery-child@example.test','Recipe Child','child','recipe-grocery-a',0),
        ('recipe-grocery-foreign','recipe-grocery-foreign@example.test','Foreign Parent','parent','recipe-grocery-b',0),
        ('recipe-grocery-default-parent','recipe-grocery-default-parent@example.test','Default Parent','parent','recipe-grocery-default',0)`,
    ),
    db
      .prepare(
        `INSERT INTO List(id,family_id,name,type,created_by,created_at,updated_at) VALUES ('recipe-grocery-list','recipe-grocery-a','Family groceries','grocery','recipe-grocery-parent',?1,?1),('recipe-grocery-foreign-list','recipe-grocery-b','Private groceries','grocery','recipe-grocery-foreign',?1,?1)`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO Ingredient(id,family_id,name,unit) VALUES ('recipe-grocery-rice','recipe-grocery-a','Rice','g'),('recipe-grocery-onion','recipe-grocery-a','Onion','pcs'),('recipe-grocery-foreign-ingredient','recipe-grocery-b','Private flour','g'),('recipe-grocery-default-ingredient','recipe-grocery-default','Default flour','g')`,
    ),
    db.prepare(
      `INSERT INTO Recipe(id,family_id,title,servings,created_by) VALUES ('recipe-grocery-recipe','recipe-grocery-a','Batch rice',4,'recipe-grocery-parent'),('recipe-grocery-foreign-recipe','recipe-grocery-b','Private recipe',2,'recipe-grocery-foreign'),('recipe-grocery-default-recipe','recipe-grocery-default','Default recipe',2,'recipe-grocery-default-parent')`,
    ),
    db.prepare(
      `INSERT INTO RecipeIngredient(id,recipe_id,ingredient_id,amount,unit) VALUES ('recipe-grocery-ri-rice','recipe-grocery-recipe','recipe-grocery-rice',2,'g'),('recipe-grocery-ri-onion','recipe-grocery-recipe','recipe-grocery-onion',1,'pcs'),('recipe-grocery-ri-foreign','recipe-grocery-foreign-recipe','recipe-grocery-foreign-ingredient',3,'g'),('recipe-grocery-ri-default','recipe-grocery-default-recipe','recipe-grocery-default-ingredient',3,'g')`,
    ),
    db
      .prepare(
        `INSERT INTO FamilyMeal(id,family_id,date,meal_type,recipe_name,recipe_id,servings,created_by) VALUES ('recipe-grocery-meal','recipe-grocery-a',?1,'dinner','Batch rice','recipe-grocery-recipe',8,'recipe-grocery-parent')`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO MealPrepSession(id,family_id,prepared_on,created_by) VALUES ('recipe-grocery-session','recipe-grocery-a',?1,'recipe-grocery-parent')`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO MealBatch(id,family_id,prep_session_id,position,name,total_servings,recipe_id) VALUES ('recipe-grocery-batch','recipe-grocery-a','recipe-grocery-session',0,'Batch rice',8,'recipe-grocery-recipe')`,
    ),
    db.prepare(
      `INSERT INTO InventoryItem(id,family_id,name,ingredient_id,amount,unit,status) VALUES ('recipe-grocery-stock','recipe-grocery-a','Rice','recipe-grocery-rice',2,'g','active')`,
    ),
    db
      .prepare(
        `INSERT INTO ListItem(id,list_id,content,checked,quantity,added_by,position,created_at,updated_at) VALUES ('recipe-grocery-lookalike','recipe-grocery-list','  RICE  ',0,1,'recipe-grocery-parent',0,?1,?1)`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO GrocerySectionPreference(id,family_id,name_key,section,updated_by) VALUES ('recipe-grocery-section','recipe-grocery-a','rice','pantry','recipe-grocery-parent')`,
    ),
  ]);

  const reviewBefore = await readD1RecipeGroceryReview(
    actor,
    { recipeId: "recipe-grocery-recipe", mealId: "recipe-grocery-meal" },
    db,
  );
  check(reviewBefore.status === 200, "recipe review succeeds");
  const review = reviewBefore.body as {
    targetServings: number;
    defaultListId: string;
    inventory: { state: string; haveIngredientIds: string[] };
  };
  check(
    review.targetServings === 8 &&
      review.defaultListId === "recipe-grocery-list",
    "meal servings and default list review",
  );
  check(
    review.inventory.state === "available" &&
      review.inventory.haveIngredientIds.includes("recipe-grocery-rice"),
    "inventory presence review",
  );
  const beforeItems = (await db
    .prepare(
      `SELECT count(*) AS n FROM ListItem WHERE list_id='recipe-grocery-list'`,
    )
    .first<{ n: number }>())!.n;
  check(beforeItems === 1, "review creates no list rows");

  const first = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      mealId: "recipe-grocery-meal",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0001",
    db,
  );
  check(first.status === 201 && !first.replayed, "recipe add writes once");
  const firstBody = first.body as {
    requestId: string;
    createdCount: number;
    possibleDuplicates: unknown[];
  };
  check(
    firstBody.createdCount === 2 && firstBody.possibleDuplicates.length === 1,
    "recipe provenance and lookalike review",
  );
  const scaled = await db
    .prepare(
      `SELECT content,amount,unit,source_key,source_request_id FROM ListItem WHERE source_request_id=?1 ORDER BY content`,
    )
    .bind(firstBody.requestId)
    .all<{
      content: string;
      amount: number;
      unit: string;
      source_key: string;
      source_request_id: string;
    }>();
  check(
    scaled.results.length === 2 &&
      scaled.results.some(
        (row) => row.content === "Rice" && row.amount === 4,
      ) &&
      scaled.results.some((row) => row.content === "Onion" && row.amount === 2),
    "scaled recipe amounts persisted",
  );
  check(
    scaled.results.every(
      (row) => row.source_key === "meal:recipe-grocery-meal",
    ),
    "meal source provenance persisted",
  );

  const replay = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      mealId: "recipe-grocery-meal",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0001",
    db,
  );
  check(
    replay.replayed &&
      JSON.stringify(replay.body) === JSON.stringify(first.body),
    "same key receipt replay",
  );
  const duplicate = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      mealId: "recipe-grocery-meal",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0002",
    db,
  );
  check(
    (duplicate.body as { createdCount: number; alreadyOnListCount: number })
      .createdCount === 0,
    "open source duplicate skipped",
  );

  const childUndo = await undoD1RecipeAdd(
    { ...actor, userId: "recipe-grocery-child", role: "child" },
    firstBody.requestId,
    new Date(),
    db,
  );
  check(childUndo.status === 403, "undo actor gate");
  await db
    .prepare(
      `UPDATE ListItem SET checked=1 WHERE source_request_id=?1 AND ingredient_id='recipe-grocery-rice'`,
    )
    .bind(firstBody.requestId)
    .run();
  const undone = await undoD1RecipeAdd(
    actor,
    firstBody.requestId,
    new Date(),
    db,
  );
  check(
    undone.status === 200 &&
      (undone.body as { removedCount: number; keptCheckedCount: number })
        .removedCount === 1 &&
      (undone.body as { keptCheckedCount: number }).keptCheckedCount === 1,
    "undo keeps checked rows",
  );

  const batch = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      batchId: "recipe-grocery-batch",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0003",
    db,
  );
  check(
    batch.status === 201 &&
      (batch.body as { createdCount: number }).createdCount === 2,
    "batch source add",
  );
  await db
    .prepare(
      `UPDATE MealPrepSession SET prepared_at=?1 WHERE id='recipe-grocery-session'`,
    )
    .bind(now)
    .run();
  const prepared = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      batchId: "recipe-grocery-batch",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0004",
    db,
  );
  check(
    prepared.status === 409 &&
      (prepared.body as { error?: { code?: string } }).error?.code ===
        "BATCH_ALREADY_PREPARED",
    "prepared batch refusal",
  );

  const manual = await addD1GroceryItem(
    actor,
    {
      listId: "recipe-grocery-list",
      content: "Cereal",
      ingredient_id: "recipe-grocery-rice",
    },
    "recipe-grocery-key-0005",
    db,
  );
  check(
    manual.status === 200 &&
      (manual.body as { item?: { source?: string; section?: string } }).item
        ?.source === "manual",
    "grocery add path",
  );
  check(
    (manual.body as { item?: { section?: string } }).item?.section === "pantry",
    "section override preserved",
  );

  const defaultAdd = await addD1RecipeToGroceries(
    defaultActor,
    { recipeId: "recipe-grocery-default-recipe", ingredientIds: undefined },
    "recipe-grocery-key-default",
    db,
  );
  const defaultBody = defaultAdd.body as {
    listId: string;
    createdCount: number;
  };
  const defaultList = await db
    .prepare(
      `SELECT id,type,name FROM List WHERE id=?1 AND family_id='recipe-grocery-default'`,
    )
    .bind(defaultBody.listId)
    .first<{ id: string; type: string; name: string }>();
  check(
    defaultAdd.status === 201 &&
      defaultBody.createdCount === 1 &&
      defaultList?.type === "grocery" &&
      defaultList.name === "Groceries",
    "default grocery list created by add",
  );

  const foreignRecipe = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-foreign-recipe",
      listId: "recipe-grocery-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0006",
    db,
  );
  const foreignList = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      listId: "recipe-grocery-foreign-list",
      ingredientIds: undefined,
    },
    "recipe-grocery-key-0007",
    db,
  );
  const foreignIngredient = await addD1RecipeToGroceries(
    actor,
    {
      recipeId: "recipe-grocery-recipe",
      ingredientIds: ["recipe-grocery-foreign-ingredient"],
      listId: "recipe-grocery-list",
    },
    "recipe-grocery-key-0008",
    db,
  );
  check(
    foreignRecipe.status === 404 &&
      foreignList.status === 404 &&
      foreignIngredient.status === 400,
    "recipe list and ingredient household proofs",
  );
  return {
    review: true,
    noReviewWrites: true,
    scaledAmounts: true,
    sourceDeduplication: true,
    sameKeyReplay: true,
    undoActorGate: true,
    undoCheckedRetention: true,
    batchSource: true,
    preparedBatchRefusal: true,
    groceryAdd: true,
    sectionOverride: true,
    defaultList: true,
    householdIsolation: true,
  };
}
