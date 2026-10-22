/** Authored/unrun. Mocked canonical graph coverage, not real DB isolation. */
import { readFoodCommitments } from "../commitment-source";
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const horizon = { from: "2026-10-22", through: "2026-10-28" };
function fixture() {
  const sessions = [
    {
      id: "pending-session",
      prepared_on: date("2026-10-22"),
      prepared_at: null,
      next_prep_on: date("2026-10-28"),
    },
    {
      id: "ready-session",
      prepared_on: date("2026-10-20"),
      prepared_at: date("2026-10-20"),
      next_prep_on: date("2026-10-26"),
    },
  ];
  const batches = [
    {
      id: "pending-batch",
      prep_session_id: "pending-session",
      name: "Pending dish",
      total_servings: 6,
      reserve_storage: "freezer",
      recipe_id: "recipe-a",
      recipe_snapshot_at: null,
    },
    {
      id: "ready-batch",
      prep_session_id: "ready-session",
      name: "Prepared dish",
      total_servings: 8,
      reserve_storage: "fridge",
      recipe_id: "recipe-b",
      recipe_snapshot_at: date("2026-10-20"),
    },
  ];
  const allocations = [
    {
      id: "allocation-one",
      batch_id: "pending-batch",
      date: date("2026-10-23"),
      servings: 2,
      recipe_id: "recipe-a",
    },
    {
      id: "allocation-two",
      batch_id: "pending-batch",
      date: date("2026-10-25"),
      servings: 2,
      recipe_id: "recipe-a",
    },
    {
      id: "allocation-ready",
      batch_id: "ready-batch",
      date: date("2026-10-21"),
      servings: 3,
      recipe_id: "recipe-b",
    },
  ];
  const consumption = [
    {
      id: "eat-one",
      batch_id: "ready-batch",
      meal_id: "allocation-ready",
      servings: 1,
      allocation_key: null,
    },
  ];
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) =>
      sql.join("").includes("AS invalid")
        ? [{ invalid: false }]
        : sessions.map((row) => ({ id: row.id })),
    ),
    mealPrepSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    mealBatch: { findMany: jest.fn().mockResolvedValue(batches) },
    familyMeal: { findMany: jest.fn().mockResolvedValue(allocations) },
    mealBatchConsumption: {
      findMany: jest.fn().mockResolvedValue(consumption),
    },
  };
  return { tx, sessions, batches, allocations, consumption };
}
it("reserves a pending whole dish once, skips its per-meal ingredient duplication, and projects prepared portions from explicit consumption only", async () => {
  const { tx } = fixture();
  // Match the requested linked batch lookup, separate from the all-session read.
  tx.mealBatch.findMany.mockResolvedValueOnce([
    { id: "pending-batch", prep_session_id: "pending-session" },
  ]);
  const result = await readFoodCommitments(tx as never, "family-a", horizon, [
    {
      id: "allocation-one",
      batch_id: "pending-batch",
      date: date("2026-10-23"),
      servings: 2,
      recipe_id: "recipe-a",
      meal_type: "dinner",
    },
  ]);
  expect(result.entries).toEqual([
    {
      id: "batch:pending-batch",
      kind: "prep-dish",
      label: "Pending dish",
      date: "2026-10-22",
      originalDate: "2026-10-22",
      recipeId: "recipe-a",
      servings: 6,
      stateUncertain: false,
    },
  ]);
  expect(result.prepared[0]).toMatchObject({
    batchId: "ready-batch",
    total: 8,
    eaten: 1,
    planned: 2,
    remaining: 7,
    unplanned: 5,
    nextPrepOn: "2026-10-26",
    recipeHistoryRecorded: true,
  });
  expect(result.pendingRecipeIds).toEqual(["recipe-a"]);
  expect(result.preparedRecipeIds).toEqual(["recipe-b"]);
  expect(
    tx.mealBatchConsumption.findMany.mock.calls[0][0].where.cancelled_at,
  ).toBeNull();
});
it("clamps overdue pending reservations to the current horizon, without pretending consumption proves preparation", async () => {
  const { tx, sessions, consumption } = fixture();
  sessions[0].prepared_on = date("2026-10-20");
  consumption.push({
    id: "odd-eat",
    batch_id: "pending-batch",
    meal_id: "allocation-one",
    servings: 1,
    allocation_key: null,
  });
  const result = await readFoodCommitments(
    tx as never,
    "family-a",
    horizon,
    [],
  );
  expect(result.entries[0]).toMatchObject({
    date: "2026-10-22",
    originalDate: "2026-10-20",
    stateUncertain: true,
  });
  expect(result.prepared).toHaveLength(1);
});
it("refuses capped or foreign-linked source graphs instead of returning a partial list as complete", async () => {
  const capped = fixture();
  capped.tx.$queryRaw.mockResolvedValueOnce(
    Array.from({ length: 51 }, (_, i) => ({ id: `session-${i}` })),
  );
  await expect(
    readFoodCommitments(capped.tx as never, "family-a", horizon, []),
  ).rejects.toMatchObject({ code: "SOURCE_LIMIT" });
  const foreign = fixture();
  foreign.tx.$queryRaw
    .mockResolvedValueOnce(foreign.sessions.map((row) => ({ id: row.id })))
    .mockResolvedValueOnce([{ invalid: true }]);
  await expect(
    readFoodCommitments(foreign.tx as never, "family-a", horizon, []),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
