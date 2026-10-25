/** Authored/unrun; callback fakes establish decisions, never real database rollback. */
jest.mock("../list-item-create", () => ({ createListItem: jest.fn() }));
jest.mock("../grocery-from-recipe", () => ({ resolveDefaultGroceryListInTx: jest.fn() }));
import { createPersonListItem, createCapturedGrocery, authorizePersonListItemReplay, type PersonListItemActor } from "../person-list-item-create";
import { createListItem } from "../list-item-create";
import { resolveDefaultGroceryListInTx } from "../grocery-from-recipe";
const base: PersonListItemActor = { familyId: "family-a", addedBy: "account-a", role: "parent", generation: 0 };
const input = { listId: "list-a", content: "Fixture item", quantity: 1 };
function setup(role = "parent") {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ family_id: base.familyId, role, token_version: 0 }) },
    family: { findUnique: jest.fn().mockResolvedValue({ features: null }) },
    list: { findFirst: jest.fn().mockResolvedValue({ type: "grocery" }) },
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue({ response_status: null, response_body: null }), update: jest.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
  return { tx, db: db as never, actor: { ...base, role } };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createListItem).mockResolvedValue({ ok: true, item: { id: "item-a", list_id: "list-a" } });
  jest.mocked(resolveDefaultGroceryListInTx).mockResolvedValue({ id: "list-a", name: "Fixture groceries", type: "grocery", created: true });
});
it.each(["parent", "teen", "child"])("preserves %s adding to an existing owned list", async role => {
  const { db, actor, tx } = setup(role);
  expect((await createPersonListItem(db, input, actor, "receipt-a")).status).toBe(200);
  expect(createListItem).toHaveBeenCalledWith(tx, input, actor, { sourceRequestId: "receipt-a", groceryOnly: undefined });
  expect(tx.idempotencyRecord.update).toHaveBeenCalledTimes(1);
  expect(tx.$queryRaw.mock.calls.slice(0, 2).map(call => call.slice(1))).toEqual([
    ["user-membership:account-a"], ["household-membership:family-a"],
  ]);
});
it.each([
  { family_id: "family-b", role: "parent", token_version: 0 },
  { family_id: base.familyId, role: "parent", token_version: 1 },
  { family_id: base.familyId, role: "child", token_version: 0 }, null,
])("holds stale actor/context before private receipt reads or any domain effect", async user => {
  const { db, actor, tx } = setup(); tx.user.findUnique.mockResolvedValue(user);
  expect((await createPersonListItem(db, input, actor, "receipt-a")).status).toBe(401);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled(); expect(createListItem).not.toHaveBeenCalled();
  expect(resolveDefaultGroceryListInTx).not.toHaveBeenCalled();
});
it("does not create a default list for a completed or missing capture receipt", async () => {
  const { db, actor, tx } = setup();
  const completed = { response_status: 200, response_body: { success: true, item: { id: "original-item" } } };
  tx.idempotencyRecord.findFirst.mockResolvedValue(completed);
  expect(await createCapturedGrocery(db, input, actor, "receipt-a"))
    .toEqual({ status: 200, body: completed.response_body });
  tx.idempotencyRecord.findFirst.mockResolvedValue(null);
  expect((await createCapturedGrocery(db, input, actor, "receipt-a")).status).toBe(409);
  expect(resolveDefaultGroceryListInTx).not.toHaveBeenCalled(); expect(createListItem).not.toHaveBeenCalled();
});
it("keeps capture's stronger default-list permission separate from ordinary child item adds", async () => {
  const { db, actor } = setup("child");
  expect((await createCapturedGrocery(db, input, actor, "receipt-a")).status).toBe(403);
  expect(resolveDefaultGroceryListInTx).not.toHaveBeenCalled();
});
it("requires transaction rollback when a newly resolved list cannot receive the captured item", async () => {
  const { db, actor, tx } = setup();
  jest.mocked(createListItem).mockResolvedValue({ ok: false, reason: "list_not_found" });
  await expect(createCapturedGrocery(db, input, actor, "receipt-a"))
    .rejects.toThrow("Captured grocery transaction could not complete");
  expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
});
it("rechecks the explicit destination kind before replay without creating anything", async () => {
  const { db, actor, tx } = setup(); tx.list.findFirst.mockResolvedValue({ type: "todo" });
  expect(await authorizePersonListItemReplay(db, actor, "list-a", { groceryOnly: true })).toMatchObject({ status: 404 });
  expect(tx.list.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "list-a", family_id: actor.familyId } }));
  expect(createListItem).not.toHaveBeenCalled(); expect(resolveDefaultGroceryListInTx).not.toHaveBeenCalled();
});
it("does not return an in-transaction completed receipt after an explicit destination was deleted", async () => {
  const { db, actor, tx } = setup();
  tx.idempotencyRecord.findFirst.mockResolvedValue({ response_status: 200, response_body: { item: { id: "old-item" } } });
  tx.list.findFirst.mockResolvedValue(null);
  expect(await createPersonListItem(db, input, actor, "receipt-a")).toMatchObject({ status: 404 });
  expect(createListItem).not.toHaveBeenCalled(); expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
});
