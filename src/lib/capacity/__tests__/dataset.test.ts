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
    if (entry.table === "chores") {
      expect(family.get(entry.row.created_by)).toBe(entry.row.family_id);
      expect(family.get(entry.row.assigned_to!)).toBe(entry.row.family_id);
      expect(entry.row.assigned_member_id).toBeNull();
    }
    if (entry.table === "prepSessions") expect(family.get(entry.row.created_by!)).toBe(entry.row.family_id);
    if (entry.table === "mealBatches") {
      expect(family.get(entry.row.prep_session_id)).toBe(entry.row.family_id);
      expect(family.get(entry.row.cook_id!)).toBe(entry.row.family_id);
    }
    if (entry.table === "mealBatchConsumption") {
      expect(family.get(entry.row.batch_id)).toBe(entry.row.family_id);
      if (entry.row.meal_id) expect(family.get(entry.row.meal_id)).toBe(entry.row.family_id);
      expect(family.get(entry.row.created_by!)).toBe(entry.row.family_id);
    }
    if (entry.table === "notes") expect(family.get(entry.row.created_by)).toBe(entry.row.family_id);
    if (entry.table === "wishlistItems") {
      expect(family.get(entry.row.requested_by)).toBe(entry.row.family_id);
      if (entry.row.status_changed_by) expect(family.get(entry.row.status_changed_by)).toBe(entry.row.family_id);
      expect(entry.row.link).toBeNull();
    }
    if (entry.table === "auditLogs") {
      expect(family.get(entry.row.actor_user_id!)).toBe(entry.row.family_id);
      expect(entry.row.target_id).toBe(entry.row.family_id);
    }
    if (entry.table === "notifications") {
      expect(family.get(entry.row.user_id)).toBe(`fx_capacity_v1_${entry.row.id.split("_")[3]}_family_0`);
      expect([null, "/dashboard/today"]).toContain(entry.row.action_url);
    }
    if (entry.table === "projects") expect(family.get(entry.row.created_by)).toBe(entry.row.family_id);
    if (entry.table === "projectTasks" && entry.row.assigned_to)
      expect(family.get(entry.row.assigned_to)).toBe(family.get(entry.row.project_id));
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
      if (entry.row.recipe_id) expect(family.get(entry.row.recipe_id)).toBe(entry.row.family_id);
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

it.each(["ordinary", "calendar", "food", "history"] as const)("constructs %s project workload with bounded parents, largest/empty and tied tasks", profile => {
  const candidate = capacityPlan({ stage: "reference", profile });
  const counts = CAPACITY_CARDINALITIES[profile];
  const projects = new Map<string, { tasks: number; status: string | undefined }>();
  let familyId: string | null = null;
  let last: { projectId: string; position: number | undefined; createdAt: string } | null = null;
  let tied = false;
  let missingDate = false;
  outer: for (const batch of capacityDatasetBatches(candidate, anchor)) {
    expect(batch.length).toBeLessThanOrEqual(200);
    for (const entry of batch) {
      if (entry.table === "families") {
        if (familyId !== null) break outer;
        familyId = entry.row.id;
      }
      if (entry.table === "projects") {
        expect(entry.row.family_id).toBe(familyId);
        projects.set(entry.row.id, { tasks: 0, status: entry.row.status });
      }
      if (entry.table === "projectTasks") {
        const project = projects.get(entry.row.project_id)!;
        expect(project).toBeDefined(); project.tasks++;
        if (project.status === "completed") expect(entry.row.completed).toBe(true);
        missingDate ||= entry.row.due_date === null;
        const createdAt = entry.row.created_at instanceof Date ? entry.row.created_at.toISOString() : String(entry.row.created_at);
        if (last?.projectId === entry.row.project_id && last.position === entry.row.position && last.createdAt === createdAt) tied = true;
        last = { projectId: entry.row.project_id, position: entry.row.position, createdAt };
      }
    }
  }
  expect(projects.size).toBe(counts.projects);
  expect(Math.max(...[...projects.values()].map(project => project.tasks))).toBe(counts.largestProjectTasks);
  expect([...projects.values()].filter(project => project.tasks === 0)).toHaveLength(1);
  expect([...projects.values()].reduce((sum, project) => sum + project.tasks, 0))
    .toBe(counts.largestProjectTasks + (counts.projects - 2) * 5);
  expect(tied).toBe(true); expect(missingDate).toBe(true);
});

it.each(["ordinary", "calendar", "food", "history"] as const)("builds %s personal histories with exact declared counts and tied keys", profile => {
  const candidate = capacityPlan({ stage: "reference", profile });
  const counts: Record<string, number> = {};
  const noticeUsers = new Set<string>();
  const wishStates = new Set<string>();
  const created = new Set<number>();
  let tied = false;
  let familyId: string | null = null;
  outer: for (const batch of capacityDatasetBatches(candidate, anchor)) {
    for (const entry of batch) {
      if (entry.table === "families") { if (familyId !== null) break outer; familyId = entry.row.id; }
      counts[entry.table] = (counts[entry.table] ?? 0) + 1;
      if (entry.table === "wishlistItems") wishStates.add(entry.row.status!);
      if (entry.table === "notifications") {
        noticeUsers.add(entry.row.user_id);
        const at = entry.row.created_at instanceof Date ? entry.row.created_at.getTime() : Date.parse(String(entry.row.created_at));
        tied ||= created.has(at); created.add(at);
      }
    }
  }
  const expected = CAPACITY_CARDINALITIES[profile];
  expect(counts.notes).toBe(expected.notes); expect(counts.wishlistItems).toBe(expected.wishlist);
  expect(counts.notifications).toBe(expected.notifications); expect(counts.auditLogs).toBe(expected.audit);
  expect(noticeUsers.size).toBe(4);
  expect(wishStates).toEqual(new Set(["idle", "on_the_way", "received", "denied"]));
  expect(tied).toBe(true);
});

it.each(["ordinary", "calendar", "food", "history"] as const)("constructs %s multi-dish prep with owned allocation/portion history", profile => {
  const candidate = capacityPlan({ stage: "reference", profile });
  const entries: import("../dataset").CapacityDatasetRow[] = [];
  let firstFamily: string | null = null;
  outer: for (const batch of capacityDatasetBatches(candidate, anchor)) {
    for (const entry of batch) {
      if (entry.table === "families") { if (firstFamily !== null) break outer; firstFamily = entry.row.id; }
      entries.push(entry);
    }
  }
  const sessions = entries.filter(entry => entry.table === "prepSessions").map(entry => entry.row);
  const batches = entries.filter(entry => entry.table === "mealBatches").map(entry => entry.row);
  const meals = entries.filter(entry => entry.table === "familyMeals").map(entry => entry.row);
  const history = entries.filter(entry => entry.table === "mealBatchConsumption").map(entry => entry.row);
  const time = (value: Date | string | undefined | null) => value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime();
  expect(sessions).toHaveLength(CAPACITY_CARDINALITIES[profile].prepSessions);
  expect(batches).toHaveLength(sessions.length * 3);
  expect(history).toHaveLength(sessions.filter(session => session.prepared_at).length * 7);
  const allocations = new Set<string>();
  for (const batch of batches) {
    const session = sessions.find(row => row.id === batch.prep_session_id)!;
    expect(session.family_id).toBe(firstFamily); expect(batch.recipe_id).toBeNull();
    const allocated = meals.filter(meal => meal.batch_id === batch.id);
    expect(allocated).toHaveLength(1);
    expect(time(allocated[0].date)).toBeGreaterThanOrEqual(time(session.prepared_on));
    const key = allocated[0].batch_allocation_key!;
    expect(allocations.has(key)).toBe(false); allocations.add(key);
    const active = history.filter(row => row.batch_id === batch.id && !row.cancelled_at);
    if (!session.prepared_at) expect(active).toHaveLength(0);
    for (const row of active) {
      if (row.meal_id) {
        expect(row.meal_id).toBe(allocated[0].id); expect(row.allocation_key).toBe(key);
        expect(time(row.consumed_at)).toBeGreaterThanOrEqual(time(allocated[0].date));
      } else expect(row.allocation_key).toBeNull();
    }
    const eaten = active.reduce((sum, row) => sum + row.servings, 0);
    const planned = 4 - active.filter(row => row.meal_id === allocated[0].id).reduce((sum, row) => sum + row.servings, 0);
    expect(eaten + planned).toBeLessThanOrEqual(batch.total_servings);
    expect(planned).toBeGreaterThanOrEqual(0);
  }
  expect(history.some(row => row.cancelled_at)).toBe(true);
  expect(history.some(row => row.meal_id === null && !row.cancelled_at)).toBe(true);
  const positions = new Map(entries.map((entry, index) => [entry.row.id, index]));
  for (const row of history) {
    expect(positions.get(row.batch_id)!).toBeLessThan(positions.get(row.id)!);
    if (row.meal_id) expect(positions.get(row.meal_id)!).toBeLessThan(positions.get(row.id)!);
  }
});

it.each(["ordinary", "calendar", "food", "history"] as const)("constructs %s account series without duplicate root/day keys", profile => {
  const candidate = capacityPlan({ stage: "reference", profile });
  const rows: Array<Extract<import("../dataset").CapacityDatasetRow, { table: "chores" }>["row"]> = [];
  let familyId: string | null = null;
  outer: for (const batch of capacityDatasetBatches(candidate, anchor)) {
    for (const entry of batch) {
      if (entry.table === "families") { if (familyId !== null) break outer; familyId = entry.row.id; }
      if (entry.table === "chores") rows.push(entry.row);
    }
  }
  const roots = new Map(rows.filter(row => row.is_template).map(row => [row.id, row]));
  const count = CAPACITY_CARDINALITIES[profile];
  expect(roots.size).toBe(count.choreRoots);
  expect(rows.length - roots.size).toBe(count.choreOccurrences);
  const keys = new Set<string>();
  const seenRoots = new Set<string>();
  const states = new Set<string>();
  const date = (value: Date | string) => value instanceof Date ? value : new Date(value);
  for (const row of rows) {
    const root = roots.get(row.recurrence_id!)!;
    expect(root).toBeDefined(); expect(row.family_id).toBe(familyId);
    const key = `${row.recurrence_id}:${date(row.due_date).toISOString()}`;
    expect(keys.has(key)).toBe(false); keys.add(key);
    expect(date(row.due_date).getUTCHours()).toBe(0);
    if (row.is_template) { seenRoots.add(row.id); expect(row.recurrence_id).toBe(row.id); expect(row.frequency).toBe("weekly"); }
    else { expect(seenRoots.has(root.id)).toBe(true); expect(row.frequency).toBe("once"); }
    if (Array.isArray(row.rotation_member_ids) && row.rotation_member_ids.length) {
      expect(row.assigned_to).toBe(row.rotation_member_ids[row.rotation_index!]);
    }
    states.add(row.status!);
    if (row.status === "pending") expect(row.completed_at).toBeNull();
    if (row.status === "verified") expect(row.verified_at).not.toBeNull();
  }
  expect(states).toEqual(new Set(["pending", "completed", "verified"]));
});
