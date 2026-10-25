/** Authored/unrun: trusted personal guards compose with the existing device-shared writer. */
jest.mock("../grocery-section-store", () => ({ recordSectionTick: jest.fn(async () => undefined) }));
import { updateListItem, updateListItemAndNoteTick } from "../list-item-update";
import { recordSectionTick } from "../grocery-section-store";
function setup() {
  const item = { id: "item-a", content: "Fixture", quantity: 1, checked: true,
    checked_by: "account-a", checked_at: new Date("2026-01-01T12:00:00Z"),
    updated_at: new Date("2026-01-01T12:00:00Z"), list: { family_id: "family-a" } };
  const tx = { idempotencyRecord: { findFirst: jest.fn().mockResolvedValue({ response_status: null, response_body: null }), update: jest.fn().mockResolvedValue({}) }, $queryRaw: jest.fn().mockResolvedValue([]), listItem: {
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

const receipt = { recordId: "receipt-a", action: "list-item.edit" as const };
it("holds missing or malformed completed receipts before reading the item", async () => {
  for (const record of [null, { response_status: 200, response_body: { success: true } }]) {
    const { tx, db } = setup();
    tx.idempotencyRecord.findFirst.mockResolvedValue(record as never);
    const result = await updateListItem(db, { itemId: "item-a", content: "Draft" }, user, undefined, { receipt });
    expect(result).toMatchObject({ status: 409, body: { error: { code: "IDEMPOTENCY_IN_PROGRESS", retryable: true } } });
    expect(tx.listItem.findUnique).not.toHaveBeenCalled();
    expect(tx.listItem.update).not.toHaveBeenCalled();
  }
});
it("returns original JSON before a stale version check and does not track another trip", async () => {
  const { tx, db } = setup();
  const body = { success: true, item: { id: "item-a", checked: true, checked_by: user.id,
    checked_at: "2026-10-24T12:00:00.000Z", content: "Original" } };
  tx.idempotencyRecord.findFirst.mockResolvedValue({ response_status: 200, response_body: body } as never);
  const result = await updateListItemAndNoteTick(db,
    { itemId: "item-a", checked: true, expectedUpdatedAt: "2025-01-01T00:00:00Z" }, user, { receipt });
  expect(result).toEqual({ status: 200, body });
  expect(tx.listItem.findUnique).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  expect(recordSectionTick).not.toHaveBeenCalled();
});
it("stores exact successful HTTP JSON inside the item transaction, including no-op ticks", async () => {
  const { tx, db, item } = setup();
  const result = await updateListItem(db, { itemId: "item-a", checked: true }, user, undefined, { receipt });
  const { list: _list, ...original } = item;
  expect(result.status).toBe(200);
  expect(tx.idempotencyRecord.update).toHaveBeenCalledWith({ where: { id: receipt.recordId }, data: {
    response_status: 200, response_body: JSON.parse(JSON.stringify({ success: true, item: original })),
  } });
});
it("propagates receipt storage failure so the enclosing transaction must roll back", async () => {
  const { tx, db } = setup();
  tx.idempotencyRecord.update.mockRejectedValue(new Error("fixture receipt storage failure"));
  await expect(updateListItem(db, { itemId: "item-a", content: "Draft" }, user, undefined, { receipt }))
    .rejects.toThrow("fixture receipt storage failure");
  expect(tx.listItem.update).toHaveBeenCalledTimes(1);
});
it("renews authority before even reading a completed receipt", async () => {
  const { tx, db } = setup();
  await updateListItem(db, { itemId: "item-a", checked: true }, user, undefined,
    { receipt, authorize: async () => ({ status: 403, body: { error: "Forbidden" } }) });
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  expect(tx.$queryRaw).not.toHaveBeenCalled();
});
