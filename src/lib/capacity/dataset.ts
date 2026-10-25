/** Pure fabricated row construction. Never imports Prisma runtime or seeds/resets a DB. */
import type { Prisma } from "@prisma/client";
import {
  buildFixtureDataset, FIXTURE_IDS,
  type FixtureFamily, type FixtureUser, type FixtureEvent,
  type FixtureList, type FixtureListItem, type FixtureRecipe,
  type FixtureIngredient, type FixtureRecipeIngredient, type FixtureFamilyMeal,
} from "../fixtures/dataset";
import { CAPACITY_MODEL_VERSION, type CapacityPlan, type CapacityProfile } from "./model";

export const CAPACITY_DATASET_VERSION = "herewoven.capacity-rows.v2";
export const CAPACITY_CARDINALITIES = {
  ordinary: { activeStock: 100, adjustments: 300, events: 100, recurringEvents: 10, lists: 8, largestListItems: 50, recipes: 40, recipeLines: 12, meals: 90 },
  calendar: { activeStock: 100, adjustments: 300, events: 2400, recurringEvents: 100, lists: 8, largestListItems: 50, recipes: 40, recipeLines: 12, meals: 90 },
  food: { activeStock: 2000, adjustments: 10000, events: 100, recurringEvents: 10, lists: 20, largestListItems: 2000, recipes: 200, recipeLines: 40, meals: 365 },
  history: { activeStock: 500, adjustments: 10000, events: 500, recurringEvents: 100, lists: 8, largestListItems: 250, recipes: 100, recipeLines: 20, meals: 365 },
} as const;
export const CAPACITY_UNSUPPORTED_DIMENSIONS = [
  "email-free-profiles-and-links", "paired-shared-devices", "inventory-reviewed-receipts-and-deleted-targets",
  "chore-roots-occurrences-and-routines", "prep-sessions-and-history", "projects-and-tasks",
  "notes-wishlist-notifications-audit", "receipts-review-undo-and-provider-fakes",
  "toronto-dst-and-special-semantic-cases",
] as const;

export const CAPACITY_FINISHED_STOCK = 6;
type CapacityInventoryItem = Omit<Prisma.InventoryItemCreateManyInput, "id"> & { id: string };
type CapacityInventoryAdjustment = Omit<Prisma.InventoryAdjustmentCreateManyInput, "id"> & { id: string };
type RowMap = { inventoryItems: CapacityInventoryItem; inventoryAdjustments: CapacityInventoryAdjustment; families: FixtureFamily; users: FixtureUser; events: FixtureEvent;
  lists: FixtureList; listItems: FixtureListItem; recipes: FixtureRecipe;
  ingredients: FixtureIngredient; recipeIngredients: FixtureRecipeIngredient; familyMeals: FixtureFamilyMeal };
export type CapacityDatasetRow = { [K in keyof RowMap]: { table: K; row: RowMap[K] } }[keyof RowMap];
const DAY = 86_400_000;
const idFor = (ordinal: number, table: string, index = 0) => `fx_capacity_v1_${ordinal}_${table}_${index}`;
/** Exactly one tied pair per five sort keys, with unique record IDs. */
const tiedKey = (index: number) => Math.floor(index / 5) * 4 + Math.min(index % 5, 3);
function anchorTime(anchor: string): number {
  const time = Date.parse(anchor);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== anchor)
    throw new Error("Capacity clock must be an explicit canonical UTC ISO instant");
  return time;
}
function validatePlan(plan: CapacityPlan) {
  if (plan.version !== CAPACITY_MODEL_VERSION || !Number.isSafeInteger(plan.households) ||
    plan.households < 1 || plan.households > 50 || plan.trafficHouseholds.length !== plan.households ||
    plan.trafficHouseholds.some((household, ordinal) => household.ordinal !== ordinal ||
      !Object.hasOwn(CAPACITY_CARDINALITIES, household.profile)) ||
    plan.sentinelOrdinals.length !== 2 || plan.sentinelOrdinals[0] !== plan.households ||
    plan.sentinelOrdinals[1] !== plan.households + 1) throw new Error("Invalid capacity dataset plan");
}

/** Actual counts are still reconciler work. These are deterministic construction expectations. */
export function capacityDatasetManifest(plan: CapacityPlan, anchor: string) {
  validatePlan(plan); anchorTime(anchor);
  const households = [...plan.trafficHouseholds.map(row => ({ ...row, sentinel: false })),
    ...plan.sentinelOrdinals.map(ordinal => ({ ordinal, profile: "ordinary" as CapacityProfile, sentinel: true }))];
  return {
    version: CAPACITY_DATASET_VERSION, model: plan.version, anchor, zone: "America/Toronto",
    complete: false as const, unsupported: [...CAPACITY_UNSUPPORTED_DIMENSIONS],
    households: households.map(household => {
      const count = CAPACITY_CARDINALITIES[household.profile];
      return { ...household, expectedRows: {
        families: 1, users: 4, events: count.events, lists: count.lists,
        // Remaining lists deliberately have five rows each, not the largest-list count.
        listItems: count.largestListItems + (count.lists - 1) * 5,
        recipes: count.recipes, ingredients: count.recipeLines,
        recipeIngredients: count.recipes * count.recipeLines, familyMeals: count.meals,
        inventoryItems: count.activeStock + CAPACITY_FINISHED_STOCK, inventoryAdjustments: count.adjustments,
      }, recurringEvents: count.recurringEvents };
    }),
  };
}

function* householdRows(ordinal: number, profile: CapacityProfile, anchor: string): Generator<CapacityDatasetRow> {
  // Reuse the existing synthetic canonical row factories; never clone legacy
  // migration rows or their intentional cross-household injections.
  const fixture = buildFixtureDataset(anchor);
  const time = anchorTime(anchor), count = CAPACITY_CARDINALITIES[profile];
  const clock = new Date(time);
  const dayStart = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  const familyId = idFor(ordinal, "family");
  const parentId = idFor(ordinal, "user", 0), teenId = idFor(ordinal, "user", 2);
  const family = fixture.families.find(row => row.id === FIXTURE_IDS.familyA.family)!;
  yield { table: "families", row: { ...family, id: familyId,
    name: `Capacity fixture household ${ordinal}`, invite_code: `fxcapacity${ordinal.toString(36).padStart(4, "0")}` } };
  const roles = ["parent", "parent", "teen", "child"] as const;
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index];
    const original = fixture.users.find(row => row.family_id === FIXTURE_IDS.familyA.family && row.role === role)!;
    yield { table: "users", row: { ...original, id: idFor(ordinal, "user", index), family_id: familyId,
      name: `Capacity ${role} ${ordinal}-${index}`, email: `capacity.${ordinal}.${index}@example.test`,
      xp: 0, level: 1, streak: 0, best_streak: 0 } };
  }
  const event = fixture.events.find(row => row.id === FIXTURE_IDS.familyA.event)!;
  for (let index = 0; index < count.events; index++) {
    const key = tiedKey(index);
    const start = time + ((key % 365) - 182) * DAY + Math.floor(key / 365) * 60_000;
    yield { table: "events", row: { ...event, id: idFor(ordinal, "event", index), family_id: familyId,
      created_by: index % 4 === 0 ? teenId : parentId, title: `Capacity event ${key} – 家庭`,
      start_time: new Date(start), end_time: new Date(start + 30 * 60_000),
      recurrence: index < count.recurringEvents ? "FREQ=WEEKLY;COUNT=4" : null,
      project_id: null, source_subscription_id: null, source_connection_id: null,
      source_uid: null, source_occurrence_start: null } };
  }
  const list = fixture.lists.find(row => row.id === FIXTURE_IDS.familyA.groceryList)!;
  const item = fixture.listItems.find(row => row.id === FIXTURE_IDS.familyA.groceryItem)!;
  for (let index = 0; index < count.lists; index++) {
    const listId = idFor(ordinal, "list", index);
    yield { table: "lists", row: { ...list, id: listId, family_id: familyId, created_by: parentId,
      name: `Capacity ${index === 0 ? "groceries" : "list"} ${index}`, type: index % 2 ? "todo" : "grocery" } };
    const items = index === 0 ? count.largestListItems : 5;
    for (let position = 0; position < items; position++) {
      const key = tiedKey(position), checked = position % 5 === 0;
      yield { table: "listItems", row: { ...item, id: idFor(ordinal, `item${index}`, position), list_id: listId,
        content: `Capacity item ${position} – café`, position: key, added_by: parentId,
        checked, purchased: false, checked_by: checked ? teenId : null,
        checked_at: checked ? new Date(time - DAY + key * 1000) : null, quantity: 1,
        created_at: new Date(time - DAY + key * 1000), updated_at: new Date(time - DAY + key * 1000),
        ingredient_id: null, recipe_id: null, meal_id: null, amount: null, unit: null } };
    }
  }
  const recipe = fixture.recipes[0], ingredient = fixture.ingredients[0], line = fixture.recipeIngredients[0];
  for (let index = 0; index < count.recipes; index++) {
    yield { table: "recipes", row: { ...recipe, id: idFor(ordinal, "recipe", index), family_id: familyId,
      created_by: parentId, title: `Capacity recipe ${tiedKey(index)} – sopa`,
      description: "Fabricated capacity recipe. No publisher content.", instructions: "Prepare the fabricated ingredients.",
      source_url: null, source_key: null, image_url: null, revision: 0, favorite: index % 5 === 0 } };
  }
  for (let index = 0; index < count.recipeLines; index++) {
    yield { table: "ingredients", row: { ...ingredient, id: idFor(ordinal, "ingredient", index),
      family_id: familyId, name: `Capacity ingredient ${index}`, unit: "pcs" } };
  }
  for (let index = 0; index < count.recipes; index++) {
    for (let position = 0; position < count.recipeLines; position++) {
      yield { table: "recipeIngredients", row: { ...line, id: idFor(ordinal, `line${index}`, position),
        recipe_id: idFor(ordinal, "recipe", index), ingredient_id: idFor(ordinal, "ingredient", position), amount: 1, unit: "pcs" } };
    }
  }
  // Manual canonical stock only: no barcode/provider product rows or recognition output.
  const historyForActive = count.adjustments - CAPACITY_FINISHED_STOCK;
  let adjustmentIndex = 0;
  for (let index = 0; index < count.activeStock + CAPACITY_FINISHED_STOCK; index++) {
    const active = index < count.activeStock;
    const finishedIndex = index - count.activeStock;
    const historyCount = active
      ? Math.floor(historyForActive / count.activeStock) + (index < historyForActive % count.activeStock ? 1 : 0)
      : 1;
    const undoLast = active && index % 10 === 0 && historyCount > 0;
    const itemId = idFor(ordinal, "stock", index);
    let remaining: number | null = active ? 10 + historyCount - (undoLast ? 1 : 0) : finishedIndex % 3 === 0 ? null : 2;
    const history: CapacityInventoryAdjustment[] = [];
    let version = new Date(time - 30 * DAY);
    for (let step = 0; step < historyCount; step++) {
      const at = new Date(time - 7 * DAY + adjustmentIndex * 1000);
      const undone = undoLast && step === historyCount - 1;
      const statusAfter = active ? "active" : finishedIndex % 2 === 0 ? "consumed" : "discarded";
      const after = active ? remaining! - 1 : remaining;
      history.push({ id: idFor(ordinal, "stock-adjustment", adjustmentIndex++), family_id: familyId,
        item_id: itemId, kind: statusAfter === "discarded" ? "discard" : "consume",
        amount_delta: active ? -1 : remaining === null ? null : -remaining,
        amount_before: remaining, amount_after: after, status_before: "active", status_after: statusAfter,
        actor_id: step % 2 ? teenId : parentId, request_id: null,
        item_version: at, created_at: at,
        undone_at: undone ? new Date(at.getTime() + 1) : null, undone_by: undone ? parentId : null });
      if (!undone) remaining = after;
      version = undone ? new Date(at.getTime() + 1) : at;
    }
    yield { table: "inventoryItems", row: {
      id: itemId, family_id: familyId, name: `Capacity ingredient ${index % count.recipeLines}`,
      ingredient_id: idFor(ordinal, "ingredient", index % count.recipeLines),
      barcode: null, product_brand: null, package_size: null, product_source: null,
      amount: remaining, unit: remaining === null ? null : "pcs",
      location: (["fridge", "freezer", "pantry"] as const)[index % 3],
      expires_on: index % 5 === 0 ? null : new Date(dayStart + ((index % 20) - 5) * DAY),
      date_kind: index % 3 === 0 ? "use_by" : "best_before", category: "other",
      purchased_on: new Date(dayStart - 30 * DAY), opened_on: index % 2 ? new Date(dayStart - 7 * DAY) : null,
      status: active ? "active" : finishedIndex % 2 === 0 ? "consumed" : "discarded",
      finished_at: active ? null : version, added_by: parentId,
      created_at: new Date(time - 30 * DAY), updated_at: version,
    } };
    for (const row of history) yield { table: "inventoryAdjustments", row };
  }
  const meal = fixture.familyMeals[0];
  for (let index = 0; index < count.meals; index++) {
    const recipeIndex = index % count.recipes;
    yield { table: "familyMeals", row: { ...meal, id: idFor(ordinal, "meal", index), family_id: familyId,
      created_by: parentId, cook_id: null, date: new Date(dayStart + ((index % 365) - 182) * DAY),
      recipe_id: idFor(ordinal, "recipe", recipeIndex), recipe_name: `Capacity recipe ${tiedKey(recipeIndex)} – sopa`,
      servings: 4, batch_id: null, batch_allocation_key: null } };
  }
}

/** Deterministic insertion order and batches <=200; caller owns any adoption/writer. */
export function* capacityDatasetBatches(plan: CapacityPlan, anchor: string): Generator<CapacityDatasetRow[]> {
  const manifest = capacityDatasetManifest(plan, anchor);
  let batch: CapacityDatasetRow[] = [];
  for (const household of manifest.households) {
    for (const row of householdRows(household.ordinal, household.profile, anchor)) {
      batch.push(row);
      if (batch.length === 200) { yield batch; batch = []; }
    }
  }
  if (batch.length) yield batch;
}
