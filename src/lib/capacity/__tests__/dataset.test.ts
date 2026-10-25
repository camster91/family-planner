/** Source only; constructing fabricated row expectations never seeds a database. */
import { capacityPlan } from "../model";
import { capacityDatasetBatches, capacityDatasetManifest, CAPACITY_CARDINALITIES, CAPACITY_FINISHED_STOCK } from "../dataset";
const anchor = "2026-01-05T12:00:00.000Z";
const plan = capacityPlan({ stage: "reference", profile: "ordinary" });

it("constructs deterministic bounded batches with exact supported-domain counts", () => {
  const manifest = capacityDatasetManifest(plan, anchor);
  const batches = [...capacityDatasetBatches(plan, anchor)];
  expect(JSON.stringify(batches)).toBe(JSON.stringify([...capacityDatasetBatches(plan, anchor)]));
  expect(batches.every(batch => batch.length > 0 && batch.length <= 200)).toBe(true);
  const counts: Record<string, number> = {};
  const ids = new Set<string>();
  for (const entry of batches.flat()) {
    counts[entry.table] = (counts[entry.table] ?? 0) + 1;
    expect(entry.row.id).toMatch(/^fx_capacity_v1_/);
    expect(ids.has(entry.row.id)).toBe(false);
    ids.add(entry.row.id);
  }
  for (const [table, count] of Object.entries(manifest.households[0].expectedRows))
    expect(counts[table]).toBe(count * manifest.households.length);
  expect(manifest.households.filter(row => row.sentinel).map(row => row.ordinal))
    .toEqual(plan.sentinelOrdinals);
  expect(manifest.complete).toBe(false);
  expect(manifest.unsupported).toContain("inventory-reviewed-receipts-and-deleted-targets");
});
it("keeps every canonical reference inside its fabricated household", () => {
  const entries = [...capacityDatasetBatches(plan, anchor)].flat();
  const family = new Map<string, string>();
  for (const entry of entries) {
    if ("family_id" in entry.row && typeof entry.row.family_id === "string")
      family.set(entry.row.id, entry.row.family_id);
  }
  for (const entry of entries) {
    const row = entry.row;
    if (entry.table === "users") expect("password" in row).toBe(false);
    if (entry.table === "events" || entry.table === "lists" || entry.table === "recipes" || entry.table === "familyMeals") {
      expect(family.get(entry.row.created_by)).toBe(entry.row.family_id);
    }
    if (entry.table === "listItems") {
      expect(family.get(entry.row.added_by)).toBe(family.get(entry.row.list_id));
      if (entry.row.checked_by) expect(family.get(entry.row.checked_by)).toBe(family.get(entry.row.list_id));
    }
    if (entry.table === "inventoryItems") {
      expect(family.get(entry.row.ingredient_id!)).toBe(entry.row.family_id);
      expect(family.get(entry.row.added_by!)).toBe(entry.row.family_id);
    }
    if (entry.table === "inventoryAdjustments") {
      expect(family.get(entry.row.item_id)).toBe(entry.row.family_id);
      expect(family.get(entry.row.actor_id!)).toBe(entry.row.family_id);
      if (entry.row.undone_by) expect(family.get(entry.row.undone_by)).toBe(entry.row.family_id);
    }
    if (entry.table === "recipeIngredients")
      expect(family.get(entry.row.recipe_id)).toBe(family.get(entry.row.ingredient_id));
    if (entry.table === "familyMeals") {
      expect(family.get(entry.row.recipe_id!)).toBe(entry.row.family_id);
      expect((entry.row.date instanceof Date ? entry.row.date : new Date(entry.row.date)).getUTCHours()).toBe(0);
    }
  }
});
it("refuses invalid clocks and altered sentinel ownership instead of inventing defaults", () => {
  expect(() => capacityDatasetManifest(plan, "2026-01-05")).toThrow();
  expect(() => capacityDatasetManifest({ ...plan, sentinelOrdinals: [0, 1] }, anchor)).toThrow();
});
it("has no cross-run object aliasing between fabricated households", () => {
  const first = [...capacityDatasetBatches(plan, anchor)].flat();
  const second = [...capacityDatasetBatches(plan, anchor)].flat();
  const family = first.find(entry => entry.table === "families")!;
  family.row.id = "fixture-mutated-locally";
  expect(second.some(entry => entry.row.id === "fixture-mutated-locally")).toBe(false);
});

it.each(["ordinary", "calendar", "food", "history"] as const)("builds canonical %s stock/history cardinalities and consistent snapshots", profile => {
  const candidate = capacityPlan({ stage: "reference", profile });
  const items = new Map<string, Extract<import("../dataset").CapacityDatasetRow, { table: "inventoryItems" }>["row"]>();
  const history = new Map<string, Array<Extract<import("../dataset").CapacityDatasetRow, { table: "inventoryAdjustments" }>["row"]>>();
  let firstFamily: string | null = null;
  outer: for (const batch of capacityDatasetBatches(candidate, anchor)) {
    for (const entry of batch) {
      if (entry.table === "families") {
        if (firstFamily !== null) break outer;
        firstFamily = entry.row.id;
      }
      if (entry.table === "inventoryItems") items.set(entry.row.id, entry.row);
      if (entry.table === "inventoryAdjustments") {
        // Insertion order must keep each stock parent ahead of its history.
        expect(items.has(entry.row.item_id)).toBe(true);
        const rows = history.get(entry.row.item_id) ?? [];
        rows.push(entry.row); history.set(entry.row.item_id, rows);
      }
    }
  }
  const count = CAPACITY_CARDINALITIES[profile];
  expect(items.size).toBe(count.activeStock + CAPACITY_FINISHED_STOCK);
  expect([...items.values()].filter(item => item.status === "active")).toHaveLength(count.activeStock);
  expect([...history.values()].reduce((sum, rows) => sum + rows.length, 0)).toBe(count.adjustments);
  const time = (value: Date | string | undefined | null) => value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime();
  let undone = 0;
  for (const item of items.values()) {
    expect(item.family_id).toBe(firstFamily);
    expect(item.barcode).toBeNull();
    expect(item.ingredient_id).toMatch(/^fx_capacity_v1_0_ingredient_/);
    if (item.expires_on) expect(new Date(time(item.expires_on)).getUTCHours()).toBe(0);
    const rows = history.get(item.id)!;
    let amount = rows[0].amount_before;
    let status = "active";
    for (const row of rows) {
      expect(row.family_id).toBe(item.family_id);
      expect(row.amount_before).toBe(amount);
      expect(row.status_before).toBe(status);
      expect(row.request_id).toBeNull();
      if (row.undone_at) {
        undone++;
        expect(time(row.undone_at)).toBeGreaterThan(time(row.item_version));
      } else {
        amount = row.amount_after; status = row.status_after;
      }
    }
    const last = rows[rows.length - 1];
    expect(item.amount).toBe(amount); expect(item.status).toBe(status);
    expect(time(item.updated_at)).toBe(time(last.undone_at ?? last.item_version));
    if (item.status === "active") { expect(item.amount).toBe(10); expect(item.finished_at).toBeNull(); }
    else expect(time(item.finished_at)).toBe(time(item.updated_at));
  }
  expect(undone).toBeGreaterThan(0);
});
