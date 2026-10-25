/** Authored/unrun: trusted personal guards compose with the existing device-shared writer. */
jest.mock("../grocery-section-store", () => ({ recordSectionTick: jest.fn(async () => undefined) }));
import { updateListItem, updateListItemAndNoteTick } from "../list-item-update";
import { recordSectionTick } from "../grocery-section-store";
function setup() {
  const item = { id: "item-a", content: "Fixture", quantity: 1, checked: true,
    checked_by: "account-a", checked_at: new Date("2026-01-01T12:00:00Z"),
    updated_at: new Date("2026-01-01T12:00:00Z"), list: { family_id: "family-a" } };
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]), listItem: {
    findUnique: jest.fn().mockResolvedValue(item), update: jest.fn().mockResolvedValue(item),
  } };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
  return { tx, db: db as never, item };
}
const user = { id: "account-a", family_id: "family-a" };
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-24T12:00:00Z"));
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());
it("denies changed personal authority before any item lock/read/write or trip tracking", async () => {
  const { tx, db } = setup();
  const authorize = jest.fn(async () => ({ status: 401 as const, body: { error: "Unauthorized" } }));
  const result = await updateListItemAndNoteTick(db, { itemId: "item-a", checked: true }, user, { authorize });
  expect(result.status).toBe(401); expect(authorize).toHaveBeenCalledWith(tx);
  expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(tx.listItem.findUnique).not.toHaveBeenCalled();
  expect(tx.listItem.update).not.toHaveBeenCalled(); expect(recordSectionTick).not.toHaveBeenCalled();
});
it("keeps the existing version conflict after current personal authority passes", async () => {
  const { tx, db } = setup();
  const authorize = jest.fn(async () => null);
  const result = await updateListItem(db, { itemId: "item-a", content: "Draft", expectedUpdatedAt: "2025-01-01T00:00:00Z" }, user, undefined, { authorize });
  expect(result).toMatchObject({ status: 409, body: { error: { code: "LIST_ITEM_CHANGED" } } });
  expect(authorize).toHaveBeenCalledWith(tx); expect(tx.listItem.update).not.toHaveBeenCalled();
});
it("retains the original attribution/version for an authorized no-op checked state", async () => {
  const { tx, db, item } = setup();
  const result = await updateListItemAndNoteTick(db, { itemId: "item-a", checked: true }, user,
    { authorize: async () => null });
  expect(result).toMatchObject({ status: 200, body: { item: { checked_by: user.id, checked_at: item.checked_at, updated_at: item.updated_at } } });
  expect(tx.listItem.update).not.toHaveBeenCalled(); expect(recordSectionTick).not.toHaveBeenCalled();
});
it("leaves the trusted device-shared entry usable without a personal guard", async () => {
  const { tx, db } = setup();
  expect((await updateListItem(db, { itemId: "item-a", checked: true }, user)).status).toBe(200);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["item-a", user.family_id]);
});
