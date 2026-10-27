// Authored UNRUN. SQL/DDL/concurrency/rollback remain separate acceptance.
jest.mock("@/lib/household-lock", () => ({ lockHousehold: jest.fn(), lockUser: jest.fn() }));
import { admitNotificationEventInTx, exportNotificationEvents } from "../notification-event-admission";
import { NOTIFICATION_EVENT_PROTOCOL } from "../notification-event-contract";
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 4 };
const event = { protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: actor.familyId,
  kind: "chore.assignment" as const, sourceId: "fixture-chore",
  sourceGeneration: "886df847-58a1-4d9f-ab74-6b3d7473969a", transitionId: "fixture-transition",
  occurredAt: "2026-10-25T12:00:00.000Z", deliverBefore: "2026-10-25T13:00:00.000Z" };
const clock = () => new Date("2026-10-25T12:30:00.000Z");
const oldFlag = process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED;
beforeEach(() => { process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED = "1"; });
afterAll(() => { if (oldFlag === undefined) delete process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED; else process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED = oldFlag; });
function txFor(inserted = true, stored: unknown = event) {
  return { $queryRaw: jest.fn()
    .mockResolvedValueOnce([{ family_id: actor.familyId, role: actor.role, token_version: actor.tokenVersion }])
    .mockResolvedValueOnce(inserted ? [{ id: "occurrence-a" }] : [])
    .mockResolvedValueOnce([{ id: "occurrence-a", envelope: stored }]),
  };
}
it("requires default-off acknowledgement before touching storage", async () => {
  delete process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED;
  const tx = txFor(); const guard = jest.fn(async () => true);
  expect(await admitNotificationEventInTx(tx as any, actor, event, guard, clock)).toEqual({ kind: "held" });
  expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
});
it("validates current authority and canonical source in the transaction before inserting", async () => {
  const tx = txFor();
  const guard = jest.fn(async () => { expect(tx.$queryRaw).toHaveBeenCalledTimes(1); return true; });
  expect(await admitNotificationEventInTx(tx as any, actor, event, guard, clock)).toEqual({ kind: "admitted", id: "occurrence-a" });
  expect(guard).toHaveBeenCalledWith(tx, event);
  expect(tx.$queryRaw.mock.calls[1][1]).toBe(actor.familyId);
  expect(tx.$queryRaw.mock.calls[1][2]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(tx.$queryRaw.mock.calls[1][3])).toEqual(event);
});
it("reuses only matching immutable evidence and refuses changed deadlines", async () => {
  expect(await admitNotificationEventInTx(txFor(false) as any, actor, event, async () => true, clock)).toEqual({ kind: "existing", id: "occurrence-a" });
  const tx = txFor(false, { ...event, deliverBefore: "2026-10-25T14:00:00.000Z" });
  await expect(admitNotificationEventInTx(tx as any, actor, event, async () => true, clock)).rejects.toThrow("admission held");
});
it("holds stale principal and refused source before admission effects", async () => {
  const stale = txFor(); stale.$queryRaw.mockReset().mockResolvedValue([{ family_id: actor.familyId, role: actor.role, token_version: 5 }]);
  const guard = jest.fn(async () => true);
  expect(await admitNotificationEventInTx(stale as any, actor, event, guard, clock)).toEqual({ kind: "held" });
  expect(guard).not.toHaveBeenCalled(); expect(stale.$queryRaw).toHaveBeenCalledTimes(1);
  const refused = txFor();
  expect(await admitNotificationEventInTx(refused as any, actor, event, async () => false, clock)).toEqual({ kind: "held" });
  expect(refused.$queryRaw).toHaveBeenCalledTimes(1);
});
it("throws after a possibly inserted event if the dispatch deadline passed while storage waited", async () => {
  const tx = txFor(); const times = [clock(), clock(), new Date(event.deliverBefore)];
  await expect(admitNotificationEventInTx(tx as any, actor, event, async () => true, () => times.shift()!)).rejects.toThrow("admission held");
});
it("exports retained metadata to a fresh parent even when admission is off", async () => {
  delete process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED;
  const tx = { $queryRaw: jest.fn(async () => [{ family_id: actor.familyId, role: actor.role, token_version: actor.tokenVersion }]),
    notificationEventOccurrence: { findMany: jest.fn(async () => [{ id: "occurrence-a", envelope: event }]) } };
  const db = { $transaction: jest.fn(async (work: (value: any) => unknown) => work(tx)) };
  expect(await exportNotificationEvents(db as any, actor)).toEqual([{ id: "occurrence-a", envelope: event }]);
  expect(tx.notificationEventOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id: actor.familyId } }));
  tx.notificationEventOccurrence.findMany.mockClear();
  expect(await exportNotificationEvents(db as any, { ...actor, role: "teen" })).toEqual([]);
  expect(tx.notificationEventOccurrence.findMany).not.toHaveBeenCalled();
});
