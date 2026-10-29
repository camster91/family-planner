import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type FoodIdentity = { food_generation: string; food_epoch: number };

/**
 * Exercises the seven non-recipe food-source rows added by 0016.  These are
 * direct D1 trigger checks: no provider calls, credentials, or application
 * HTTP routes are involved.  The fixture intentionally attempts forged
 * identity/epoch writes and verifies that a delete/recreate gets a new birth
 * generation rather than reviving a stale grounded snapshot.
 */
export async function testFoodSourceGuards(db: D1Store) {
  const now = Date.now();
  await db.batch([
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('food-source-a','Food source A','food-source-code-a','{"meals":true,"lists":true}')`,
    ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id,email_verified) VALUES ('food-source-parent','food-source-parent@example.test','Food Parent','parent','food-source-a',1)`,
    ),
    db.prepare(
      `INSERT INTO List(id,family_id,name,type,created_by) VALUES ('food-source-list','food-source-a','Food list','grocery','food-source-parent')`,
    ),
    db
      .prepare(
        `INSERT INTO MealPrepSession(id,family_id,prepared_on,created_by,created_at) VALUES ('food-source-session','food-source-a',?1,'food-source-parent',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO MealBatch(id,family_id,prep_session_id,position,name,total_servings,cook_id,created_at) VALUES ('food-source-batch','food-source-a','food-source-session',0,'Batch',4,'food-source-parent',?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO FamilyMeal(id,family_id,date,meal_type,created_by,recipe_name,created_at,updated_at) VALUES ('food-source-meal','food-source-a',?1,'dinner','food-source-parent','Batch meal',?1,?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO MealBatchConsumption(id,family_id,batch_id,meal_id,servings,created_by,consumed_at) VALUES ('food-source-consumption','food-source-a','food-source-batch','food-source-meal',1,'food-source-parent',?1)`,
      )
      .bind(now),
  ]);

  const models = [
    {
      table: "Family",
      id: "food-source-a",
      update: `UPDATE "Family" SET name='Food source A revised' WHERE id=?1`,
    },
    {
      table: "User",
      id: "food-source-parent",
      update: `UPDATE "User" SET name='Food Parent revised' WHERE id=?1`,
    },
    {
      table: "FamilyMeal",
      id: "food-source-meal",
      update: `UPDATE "FamilyMeal" SET notes='updated' WHERE id=?1`,
    },
    {
      table: "MealPrepSession",
      id: "food-source-session",
      update: `UPDATE "MealPrepSession" SET prepared_at=?1 WHERE id=?2`,
      args: [now],
    },
    {
      table: "MealBatch",
      id: "food-source-batch",
      update: `UPDATE "MealBatch" SET name='Batch revised' WHERE id=?1`,
    },
    {
      table: "MealBatchConsumption",
      id: "food-source-consumption",
      update: `UPDATE "MealBatchConsumption" SET servings=2 WHERE id=?1`,
    },
    {
      table: "List",
      id: "food-source-list",
      update: `UPDATE "List" SET name='Food list revised' WHERE id=?1`,
    },
  ] as const;

  for (const model of models) {
    const before = await db
      .prepare(
        `SELECT food_generation,food_epoch FROM "${model.table}" WHERE id=?1`,
      )
      .bind(model.id)
      .first<FoodIdentity>();
    check(
      before &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          before.food_generation,
        ) &&
        before.food_epoch === 0,
      `${model.table} birth identity`,
    );
    const statement = db.prepare(model.update);
    if ("args" in model) await statement.bind(...model.args, model.id).run();
    else await statement.bind(model.id).run();
    const after = await db
      .prepare(
        `SELECT food_generation,food_epoch FROM "${model.table}" WHERE id=?1`,
      )
      .bind(model.id)
      .first<FoodIdentity>();
    check(
      after?.food_generation === before.food_generation &&
        after.food_epoch === 1,
      `${model.table} epoch continuity`,
    );

    await checkRejects(
      db
        .prepare(`UPDATE "${model.table}" SET food_generation=?1 WHERE id=?2`)
        .bind("00000000-0000-4000-8000-000000000000", model.id),
      `${model.table} generation guard`,
    );
    await checkRejects(
      db
        .prepare(`UPDATE "${model.table}" SET food_epoch=99 WHERE id=?1`)
        .bind(model.id),
      `${model.table} epoch guard`,
    );
  }

  const oldList = await db
    .prepare(`SELECT food_generation FROM List WHERE id=?1`)
    .bind("food-source-list")
    .first<{ food_generation: string }>();
  await db
    .prepare(`DELETE FROM List WHERE id=?1`)
    .bind("food-source-list")
    .run();
  await db
    .prepare(
      `INSERT INTO List(id,family_id,name,type,created_by) VALUES ('food-source-list','food-source-a','Food list recreated','grocery','food-source-parent')`,
    )
    .run();
  const recreated = await db
    .prepare(`SELECT food_generation,food_epoch FROM List WHERE id=?1`)
    .bind("food-source-list")
    .first<FoodIdentity>();
  check(
    oldList?.food_generation &&
      recreated?.food_generation &&
      recreated.food_generation !== oldList.food_generation &&
      recreated.food_epoch === 0,
    "delete/recreate gets a new food birth",
  );

  return {
    birthIdentity: true,
    epochContinuity: true,
    forgedWritesRefused: true,
    deleteRecreateIdentity: true,
  };
}

async function checkRejects(
  statement: { run(): Promise<unknown> },
  message: string,
) {
  let refused = false;
  try {
    await statement.run();
  } catch {
    refused = true;
  }
  check(refused, message);
}
