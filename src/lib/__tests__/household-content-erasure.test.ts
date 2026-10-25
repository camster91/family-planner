/** Authored source only; actual FK/locking/transaction acceptance is deferred. */
import {
  accountContentHouseholds, handOverRetainedContentInTx,
  HOUSEHOLD_HANDOVER_COLUMNS, HOUSEHOLD_CLEARED_REFERENCES,
} from "../household-content-erasure";
function txFixture() {
  const models = new Set([...HOUSEHOLD_HANDOVER_COLUMNS, ...HOUSEHOLD_CLEARED_REFERENCES].map(([model]) => model));
  models.add("routineStack"); models.add("upload");
  const tx: Record<string, any> = {};
  for (const model of models) tx[model] = { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), updateMany: jest.fn() };
  tx.user = { findFirst: jest.fn(async () => null) };
  return tx;
}
it("discovers child ownership through List and Project instead of invented family columns", async () => {
  const tx = txFixture();
  tx.listItem.findMany.mockResolvedValue([{ list: { family_id: "old" } }]);
  tx.projectTask.findMany.mockResolvedValue([{ project: { family_id: "current" } }]);
  expect(await accountContentHouseholds(tx, "departing")).toEqual(["current", "old"]);
  expect(tx.listItem.findMany).toHaveBeenCalledWith({
    where: { OR: [{ added_by: "departing" }, { checked_by: "departing" }] },
    select: { list: { select: { family_id: true } } }, distinct: ["list_id"],
  });
});
it("refuses an unknown/foreign successor before any ownership update", async () => {
  const tx = txFixture();
  await expect(handOverRetainedContentInTx(tx, "old", "departing", "foreign-parent")).rejects.toThrow("successor unavailable");
  expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { id: "foreign-parent", family_id: "old" }, select: { id: true } });
  for (const [model] of HOUSEHOLD_HANDOVER_COLUMNS) expect(tx[model].updateMany).not.toHaveBeenCalled();
});
it("holds unknown historical content ownership rather than skipping it", async () => {
  const tx = txFixture();
  tx.listItem.findMany.mockResolvedValue([{ list: null }]);
  await expect(accountContentHouseholds(tx, "departing")).rejects.toThrow("ownership unavailable");
});
