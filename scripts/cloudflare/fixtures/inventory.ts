import {
  adjustD1Inventory,
  createD1Inventory,
  deleteD1Inventory,
  readD1Inventory,
  readD1InventoryAdjustments,
  readD1InventoryItem,
  readD1UseSoon,
  undoD1InventoryAdjustment,
  updateD1Inventory,
} from "../../../src/lib/cloudflare/inventory";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Disposable two-household inventory fixture. The main native fixture worker
 * owns route registration; this file only exercises the inventory boundary. */
export async function testInventory(db: D1Store) {
  await db.batch([
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('inventory-a','Inventory A','inventory-code-a','{"inventory":true,"meals":true}'),('inventory-b','Inventory B','inventory-code-b','{"inventory":true,"meals":true}')`,
    ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id,email_verified) VALUES ('inventory-parent','inventory-parent@example.test','Parent','parent','inventory-a',1),('inventory-child','inventory-child@example.test','Child','child','inventory-a',1),('inventory-other','inventory-other@example.test','Other','parent','inventory-b',1)`,
    ),
    db.prepare(
      `INSERT INTO Ingredient(id,family_id,name) VALUES ('inventory-ingredient','inventory-a','Milk'),('inventory-foreign-ingredient','inventory-b','Milk')`,
    ),
  ]);
  const actor = {
      userId: "inventory-parent",
      familyId: "inventory-a",
      role: "parent",
      generation: 0,
    } as const,
    child = { ...actor, userId: "inventory-child", role: "child" } as const,
    foreign = {
      userId: "inventory-other",
      familyId: "inventory-b",
      role: "parent",
      generation: 0,
    } as const,
    today = new Date("2026-10-28T00:00:00.000Z");

  const denied = await createD1Inventory(
    child,
    { name: "No", amount: 1, ingredient_id: null },
    today,
    null,
    db,
  );
  check(denied.status === 403, "child cannot write inventory");

  const created = await createD1Inventory(
    actor,
    {
      name: "Milk",
      amount: 2,
      unit: "cartons",
      location: "fridge",
      expires_on: "2026-10-29",
      ingredient_id: "inventory-ingredient",
    },
    today,
    "inventory-create",
    db,
  );
  check(created.status === 201, "inventory create");
  const item = (created.body as { item: { id: string } }).item;
  const replay = await createD1Inventory(
    actor,
    {
      name: "Milk",
      amount: 2,
      unit: "cartons",
      location: "fridge",
      expires_on: "2026-10-29",
      ingredient_id: "inventory-ingredient",
    },
    today,
    "inventory-create",
    db,
  );
  check(replay.replayed, "inventory create replay");
  let foreignIngredientRefused = false;
  try {
    await createD1Inventory(
      actor,
      { name: "Foreign", ingredient_id: "inventory-foreign-ingredient" },
      today,
      null,
      db,
    );
  } catch {
    foreignIngredientRefused = true;
  }
  check(foreignIngredientRefused, "foreign ingredient refused");

  const own = await readD1Inventory(actor, {
    today,
    limit: 10,
    offset: 0,
    query: "milk",
  }, db);
  check(!own.refusal && own.page?.items.length === 1, "own inventory read");
  const other = await readD1Inventory(foreign, {
    today,
    limit: 10,
    offset: 0,
  }, db);
  check(!other.refusal && other.page?.items.length === 0, "household isolation");
  check(
    (await readD1InventoryItem(foreign, item.id, today, db)).item === null,
    "foreign item hidden",
  );

  const before = await db
    .prepare(`SELECT food_generation,food_epoch FROM InventoryItem WHERE id=?1`)
    .bind(item.id)
    .first<{ food_generation: string; food_epoch: number }>();
  const updated = await updateD1Inventory(
    actor,
    item.id,
    { category: "dairy_eggs" },
    today,
    "inventory-update",
    db,
  );
  check(updated.status === 200, "inventory update");
  const afterUpdate = await db
    .prepare(`SELECT food_generation,food_epoch FROM InventoryItem WHERE id=?1`)
    .bind(item.id)
    .first<{ food_generation: string; food_epoch: number }>();
  check(
    before?.food_generation === afterUpdate?.food_generation &&
      (afterUpdate?.food_epoch ?? 0) > (before?.food_epoch ?? 0),
    "food identity preserved and epoch advanced",
  );

  const adjusted = await adjustD1Inventory(
    actor,
    item.id,
    "consume",
    1,
    today,
    "inventory-adjust",
    db,
  );
  check(adjusted.status === 200, "partial consume");
  const adjustmentId = (adjusted.body as { adjustment: { id: string } }).adjustment.id;
  const history = await readD1InventoryAdjustments(actor, { limit: 10, offset: 0 }, db);
  check(!history.refusal && history.adjustments?.length === 1, "inventory history");
  const undone = await undoD1InventoryAdjustment(actor, adjustmentId, today, "inventory-undo", db);
  check(undone.status === 200, "inventory undo");
  const soon = await readD1UseSoon(actor, { today, days: 3, limit: 10 }, db);
  check(!soon.refusal && soon.items?.some((row) => row.id === item.id), "use soon read");

  check(
    (await deleteD1Inventory(actor, item.id, "inventory-delete", db)).status === 200,
    "inventory delete",
  );
  return {
    householdIsolation: true,
    roleGate: true,
    receiptReplay: true,
    epochContinuity: true,
    adjustmentsUndo: true,
    useSoon: true,
  };
}
