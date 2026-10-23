/** Authored compatibility cases only; no database/schema command was run. */
import { clearHouseholdEventPreparationInTx } from "../storage";
it("does not require a new generated delegate or attempt a missing-table delete", async () => {
  const tx = {
    $queryRaw: jest.fn(async () => [{ present: false }]),
    $executeRaw: jest.fn(),
  };
  await clearHouseholdEventPreparationInTx(tx as never, "family-a", "steps");
  await clearHouseholdEventPreparationInTx(tx as never, "family-a", "plans");
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it("binds explicit metadata cleanup to the already-authorized family after canonical Event cleanup", async () => {
  const tx = {
    $queryRaw: jest.fn(async () => [{ present: true }]),
    $executeRaw: jest.fn(async () => 0),
  };
  await clearHouseholdEventPreparationInTx(tx as never, "family-a", "plans");
  expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything(), "family-a");
});
it("does not probe preparation metadata for child, missing-household or device-like export contexts", async () => {
  const { exportEventPreparation } = await import("../storage");
  const tx = { $queryRaw: jest.fn() };
  for (const role of ["child", "teen", undefined]) {
    expect(
      await exportEventPreparation(tx as never, {
        userId: "a",
        familyId: "f",
        role,
        eventIds: ["e"],
        choreIds: ["c"],
      }),
    ).toEqual([]);
  }
  expect(tx.$queryRaw).not.toHaveBeenCalled();
});
it("exports scoped links only against already-authorized canonical event and chore IDs", async () => {
  const { exportEventPreparation } = await import("../storage");
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ ready: true }])
      .mockResolvedValueOnce([]),
  };
  await exportEventPreparation(tx as never, {
    userId: "parent-a",
    familyId: "family-a",
    role: "parent",
    eventIds: ["event-a"],
    choreIds: ["chore-a"],
  });
  const [sql, ...values] = tx.$queryRaw.mock.calls[1];
  expect(sql.join("")).toContain("u.\"role\"='parent'");
  expect(sql.join("")).toContain('c."family_id"=s."family_id"');
  expect(values).toEqual([
    '["chore-a"]',
    "family-a",
    '["event-a"]',
    "parent-a",
  ]);
});
