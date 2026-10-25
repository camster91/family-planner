/** Source only; constructing fabricated row expectations never seeds a database. */
import { capacityPlan } from "../model";
import { capacityDatasetBatches, capacityDatasetManifest } from "../dataset";
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
  expect(manifest.unsupported).toContain("inventory-and-adjustments");
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
