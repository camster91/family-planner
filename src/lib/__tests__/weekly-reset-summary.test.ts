/** Authored source cases. Not PostgreSQL, migration, rendered or release proof. */
import type { Prisma } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import {
  loadWeeklyResetSummaryInTx,
  weeklyResetWindow,
  weeklyResetSummaryQuery,
} from "../weekly-reset-summary";

const scope = { weekStart: "2026-10-19", timeZone: "America/Toronto" };
const actor = {
  userId: "user-a",
  familyId: "family-a",
  role: "parent",
  emailVerified: true,
};
const now = new Date("2026-10-23T16:00:00Z");
function fixture() {
  const tx = {
    event: { findMany: jest.fn(async () => [] as unknown[]) },
    chore: { findMany: jest.fn(async () => [] as unknown[]) },
    pickup: { findMany: jest.fn(async () => [] as unknown[]) },
    handoff: { findMany: jest.fn(async () => [] as unknown[]) },
    familyMeal: { findMany: jest.fn(async () => [] as unknown[]) },
    mealPrepSession: { findMany: jest.fn(async () => [] as unknown[]) },
    mealBatchConsumption: {
      aggregate: jest.fn(async () => ({ _sum: { servings: 3 } })),
    },
    inventoryItem: { findMany: jest.fn(async () => [] as unknown[]) },
    listItem: {
      findMany: jest.fn(async () => [] as unknown[]),
      count: jest.fn(async () => 0),
    },
    $queryRaw: jest.fn(async () => []),
  };
  return { tx, db: tx as unknown as Prisma.TransactionClient };
}
it("rejects ambiguous/unknown step scopes and computes actual DST week instants", () => {
  expect(
    weeklyResetSummaryQuery.safeParse({ ...scope, step: "anything" }).success,
  ).toBe(false);
  expect(
    weeklyResetSummaryQuery.safeParse({
      ...scope,
      step: "meals",
      familyId: "foreign",
    }).success,
  ).toBe(false);
  const window = weeklyResetWindow({
    weekStart: "2026-10-26",
    timeZone: scope.timeZone,
  });
  expect(window.dateStart.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  expect(window.dateEnd.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  expect(window.instantEnd.getTime() - window.instantStart.getTime()).toBe(
    169 * 60 * 60 * 1000,
  );
});
it("does not read hidden/disabled steps, including child meal/prep data", async () => {
  const { tx, db } = fixture();
  for (const step of ["meals", "prep"] as const)
    await expect(
      loadWeeklyResetSummaryInTx(
        db,
        { ...actor, role: "child" },
        defaultFeatures(),
        scope,
        step,
        now,
      ),
    ).rejects.toThrow("STEP_UNAVAILABLE");
  await expect(
    loadWeeklyResetSummaryInTx(
      db,
      actor,
      { ...defaultFeatures(), inventory: false },
      scope,
      "food",
      now,
    ),
  ).rejects.toThrow("STEP_UNAVAILABLE");
  expect(tx.familyMeal.findMany).not.toHaveBeenCalled();
  expect(tx.mealPrepSession.findMany).not.toHaveBeenCalled();
  expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
});
it("bounds schedule fields before returning the shared-safe child preview", async () => {
  const { tx, db } = fixture();
  tx.event.findMany.mockResolvedValue(
    Array.from({ length: 9 }, () => ({
      title: "a".repeat(500),
      start_time: now,
      end_time: new Date(now.getTime() + 3600000),
    })),
  );
  const summary = await loadWeeklyResetSummaryInTx(
    db,
    { ...actor, role: "child" },
    defaultFeatures(),
    scope,
    "schedule",
    now,
  );
  expect(summary.groups[0].rows).toHaveLength(8);
  expect(summary.groups[0].more).toBe(true);
  expect(summary.groups[0].rows[0].title).toHaveLength(240);
  expect(tx.event.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ family_id: actor.familyId }),
      select: { title: true, start_time: true, end_time: true },
      take: 9,
    }),
  );
  expect(tx.familyMeal.findMany).not.toHaveBeenCalled();
  expect(tx.listItem.findMany).not.toHaveBeenCalled();
});
it("limits teen chore reads to the authenticated account without implying accepted ownership", async () => {
  const { tx, db } = fixture();
  const summary = await loadWeeklyResetSummaryInTx(
    db,
    { ...actor, role: "teen" },
    defaultFeatures(),
    scope,
    "responsibilities",
    now,
  );
  expect(tx.chore.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        family_id: actor.familyId,
        assigned_to: actor.userId,
        member_subject_erased: false,
        assignee: { is: { family_id: actor.familyId } },
      }),
    }),
  );
  expect(summary.notes).toEqual(
    expect.arrayContaining([
      "acceptanceAndBackupUnknown",
      "profileChoresInChores",
    ]),
  );
  expect(tx.pickup.findMany).not.toHaveBeenCalled();
  expect(tx.handoff.findMany).not.toHaveBeenCalled();
});
it("uses all uncancelled consumption for portions and keeps planned prep distinct from prepared food", async () => {
  const { tx, db } = fixture();
  tx.mealPrepSession.findMany.mockResolvedValue([
    {
      prepared_on: new Date("2026-10-18T00:00:00Z"),
      next_prep_on: new Date("2026-10-24T00:00:00Z"),
      prepared_at: now,
      batches: [
        { id: "batch-a", name: "Soup", total_servings: 8 },
        { id: "batch-b", name: "Chili", total_servings: 6 },
      ],
    },
  ]);
  const summary = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    defaultFeatures(),
    scope,
    "prep",
    now,
  );
  expect(
    summary.groups[0].rows.map((row) => [
      row.title,
      row.eaten,
      row.remaining,
      row.nextPrep,
    ]),
  ).toEqual([
    ["Soup", 3, 5, "2026-10-24"],
    ["Chili", 3, 3, "2026-10-24"],
  ]);
  expect(tx.mealBatchConsumption.aggregate).toHaveBeenCalledWith({
    where: {
      family_id: actor.familyId,
      batch_id: "batch-a",
      cancelled_at: null,
    },
    _sum: { servings: true },
  });
  tx.mealPrepSession.findMany.mockResolvedValue([
    {
      prepared_on: now,
      next_prep_on: null,
      prepared_at: null,
      batches: [{ id: "batch-c", name: "Rice", total_servings: 5 }],
    },
  ]);
  const planned = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    defaultFeatures(),
    scope,
    "prep",
    now,
  );
  expect(planned.groups[0].rows[0].prepared).toBe(false);
  expect(planned.groups[0].rows[0]).not.toHaveProperty("remaining");
});
it("preserves verified-email gating for prep and fails a broken source rather than returning empty success", async () => {
  const { tx, db } = fixture();
  const held = await loadWeeklyResetSummaryInTx(
    db,
    { ...actor, emailVerified: false },
    defaultFeatures(),
    scope,
    "prep",
    now,
  );
  expect(held.notes).toEqual(["prepRequiresVerifiedEmail"]);
  expect(tx.mealPrepSession.findMany).not.toHaveBeenCalled();
  tx.familyMeal.findMany.mockRejectedValue(new Error("database unavailable"));
  await expect(
    loadWeeklyResetSummaryInTx(
      db,
      actor,
      defaultFeatures(),
      scope,
      "meals",
      now,
    ),
  ).rejects.toThrow("database unavailable");
});
it("anchors use-by safety to actual local today even when reviewing a previous week", async () => {
  const { tx, db } = fixture();
  const result = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    { ...defaultFeatures(), inventory: true },
    { ...scope, weekStart: "2026-10-12" },
    "food",
    now,
  );
  expect(result.notes).toContain("currentFoodSnapshot");
  expect(tx.inventoryItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        family_id: actor.familyId,
        OR: [
          { date_kind: { not: "use_by" } },
          { expires_on: { gte: new Date("2026-10-23T00:00:00Z") } },
        ],
      }),
    }),
  );
});
it("reports open groceries separately from unknown ingredient coverage", async () => {
  const { tx, db } = fixture();
  tx.listItem.count.mockResolvedValue(17);
  const result = await loadWeeklyResetSummaryInTx(
    db,
    actor,
    defaultFeatures(),
    scope,
    "groceries",
    now,
  );
  expect(result.groups[0]).toMatchObject({
    kind: "groceries",
    total: 17,
    more: true,
  });
  expect(result.notes).toContain("groceryGapsNotAssessed");
  expect(tx.listItem.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        checked: false,
        list: { family_id: actor.familyId, type: { in: ["grocery"] } },
      },
    }),
  );
});
it("does not retrieve recipes behind a child's grocery review even when meals/inventory are enabled", async () => {
  const { tx, db } = fixture();
  const result = await loadWeeklyResetSummaryInTx(
    db,
    { ...actor, role: "child" },
    { ...defaultFeatures(), inventory: true },
    scope,
    "groceries",
    now,
  );
  expect(result.groups.map((group) => group.kind)).toEqual(["groceries"]);
  expect(result.notes).toContain("groceryGapsNotAssessed");
  expect(tx.familyMeal.findMany).not.toHaveBeenCalled();
  expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
});
