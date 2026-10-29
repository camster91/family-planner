import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  d1FoodSourceStorageAvailable,
  readD1FoodSourceVersions,
} from "../../../src/lib/cloudflare/food-source-versions";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/**
 * Grounding witness for all eleven food-source kinds.  This uses only
 * fabricated household rows and exercises the same positive/negative source
 * selection checks used by food planning and AI grounding.
 */
export async function testFoodSourceVersions(db: D1Store) {
  const now = Date.now();
  await db.batch([
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('food-versions-family','Food versions','food-versions-code','{"meals":true,"lists":true}')`,
    ),
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('food-versions-foreign','Foreign','food-versions-foreign-code','{"meals":true,"lists":true}')`,
    ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id,email_verified) VALUES ('food-versions-parent','food-versions-parent@example.test','Food Versions Parent','parent','food-versions-family',1),('food-versions-foreign-user','food-versions-foreign@example.test','Foreign User','parent','food-versions-foreign',1)`,
    ),
    db.prepare(
      `INSERT INTO Recipe(id,family_id,title,created_by) VALUES ('food-versions-recipe','food-versions-family','Grounded recipe','food-versions-parent')`,
    ),
    db.prepare(
      `INSERT INTO Ingredient(id,family_id,name) VALUES ('food-versions-ingredient','food-versions-family','Grounded ingredient')`,
    ),
    db.prepare(
      `INSERT INTO RecipeIngredient(id,recipe_id,ingredient_id,amount) VALUES ('food-versions-line','food-versions-recipe','food-versions-ingredient',1)`,
    ),
    db.prepare(
      `INSERT INTO InventoryItem(id,family_id,name,amount,added_by) VALUES ('food-versions-inventory','food-versions-family','Grounded inventory',1,'food-versions-parent')`,
    ),
    db.prepare(
      `INSERT INTO List(id,family_id,name,type,created_by) VALUES ('food-versions-list','food-versions-family','Grounded list','grocery','food-versions-parent')`,
    ),
    db
      .prepare(
        `INSERT INTO MealPrepSession(id,family_id,prepared_on,created_by,created_at) VALUES ('food-versions-session','food-versions-family',?1,'food-versions-parent',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO MealBatch(id,family_id,prep_session_id,position,name,total_servings,cook_id,created_at) VALUES ('food-versions-batch','food-versions-family','food-versions-session',0,'Grounded batch',2,'food-versions-parent',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO FamilyMeal(id,family_id,date,meal_type,recipe_name,created_by,created_at,updated_at) VALUES ('food-versions-meal','food-versions-family',?1,'dinner','Grounded meal','food-versions-parent',?1,?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO MealBatchConsumption(id,family_id,batch_id,meal_id,servings,created_by,consumed_at) VALUES ('food-versions-consumption','food-versions-family','food-versions-batch','food-versions-meal',1,'food-versions-parent',?1)`,
      )
      .bind(now),
  ]);

  check(
    await d1FoodSourceStorageAvailable(db),
    "all eleven D1 food-source guards are ready",
  );
  const selection = {
    Family: ["food-versions-family"],
    User: ["food-versions-parent"],
    Recipe: ["food-versions-recipe"],
    RecipeIngredient: ["food-versions-line"],
    Ingredient: ["food-versions-ingredient"],
    InventoryItem: ["food-versions-inventory"],
    FamilyMeal: ["food-versions-meal"],
    MealPrepSession: ["food-versions-session"],
    MealBatch: ["food-versions-batch"],
    MealBatchConsumption: ["food-versions-consumption"],
    List: ["food-versions-list"],
  } as const;
  const positive = await readD1FoodSourceVersions(
    db,
    "food-versions-family",
    selection,
  );
  check(positive.length === 11, "positive all-kind grounding snapshot");
  check(
    positive.every((row) => row.epoch === 0 && row.generation.length === 36),
    "birth generation and epoch",
  );

  let foreignRefused = false;
  try {
    await readD1FoodSourceVersions(db, "food-versions-family", {
      User: ["food-versions-foreign-user"],
    });
  } catch {
    foreignRefused = true;
  }
  check(foreignRefused, "foreign source refused");

  let missingRefused = false;
  try {
    await readD1FoodSourceVersions(db, "food-versions-family", {
      Recipe: ["food-versions-missing"],
    });
  } catch {
    missingRefused = true;
  }
  check(missingRefused, "missing source refused");
  return {
    storage: true,
    positive: true,
    allKinds: true,
    foreignRefused,
    missingRefused,
  };
}
