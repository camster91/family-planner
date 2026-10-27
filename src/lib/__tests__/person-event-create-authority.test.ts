/** Authored/unrun. Mocked transactions do not establish PostgreSQL locking or rollback. */
jest.mock("../beta-metrics", () => ({ recordBetaMetric: jest.fn(async () => undefined) }));
import { createPersonEvent, authorizePersonEventCreationReplay } from "../person-event-create";
import { recordBetaMetric } from "../beta-metrics";
import type { AssistantSourceGuard } from "../assistant-source-proof";
const actor = { userId: "account-a", familyId: "family-a", tokenVersion: 0, name: "Fixture person" };
const input = { title: "Fixture event", start_time: "2026-10-24T17:00:00.000Z", event_type: "other" as const };
function setup(role = "parent") {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ family_id: actor.familyId, role, token_version: 0 }) },
    family: { findUnique: jest.fn().mockResolvedValue({ id: actor.familyId }) },
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue({ response_status: null, response_body: null }), update: jest.fn().mockResolvedValue({}) },
    event: { create: jest.fn().mockResolvedValue({ id: "event-a", title: input.title }) },
    activity: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx), $executeRaw: jest.fn() };
  return { tx, db: db as never };
}
beforeEach(() => jest.clearAllMocks());
it.each(["parent", "teen", "child"])("retains %s creation permission and one canonical event/activity/receipt", async role => {
  const { tx, db } = setup(role);
  expect((await createPersonEvent(db, input, actor, "receipt-a")).status).toBe(200);
  expect(tx.event.create).toHaveBeenCalledTimes(1); expect(tx.activity.create).toHaveBeenCalledTimes(1);
  expect(tx.idempotencyRecord.update).toHaveBeenCalledTimes(1); expect(recordBetaMetric).toHaveBeenCalledTimes(1);
  expect(tx.event.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ family_id: actor.familyId, created_by: actor.userId }) }));
  expect(tx.$queryRaw.mock.calls.slice(0, 2).map(call => call.slice(1))).toEqual([
    ["user-membership:account-a"], ["household-membership:family-a"],
  ]);
});
it.each([
  { family_id: "family-b", role: "parent", token_version: 0 },
  { family_id: actor.familyId, role: "parent", token_version: 1 },
  { family_id: actor.familyId, role: "unknown", token_version: 0 },
  null,
])("refuses stale/foreign/unsupported current actors before effects or private receipt reads", async user => {
  const { tx, db } = setup(); tx.user.findUnique.mockResolvedValue(user);
  expect([401, 403]).toContain((await createPersonEvent(db, input, actor, "receipt-a")).status);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled(); expect(tx.event.create).not.toHaveBeenCalled();
  expect(tx.activity.create).not.toHaveBeenCalled(); expect(recordBetaMetric).not.toHaveBeenCalled();
});
it("holds an absent household before an unkeyed create", async () => {
  const { tx, db } = setup(); tx.family.findUnique.mockResolvedValue(null);
  expect((await createPersonEvent(db, input, actor, null)).status).toBe(404);
  expect(tx.event.create).not.toHaveBeenCalled(); expect(tx.activity.create).not.toHaveBeenCalled();
});
it("refuses normal completed replay after the actor leaves the original household", async () => {
  const { tx, db } = setup(); tx.user.findUnique.mockResolvedValue({ family_id: "family-b", role: "parent", token_version: 0 });
  expect(await authorizePersonEventCreationReplay(db, actor)).toMatchObject({ status: 403 });
  expect(tx.event.create).not.toHaveBeenCalled(); expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
});
it("renews assistant ownership for replay without rerunning expired source verification", async () => {
  const { tx, db } = setup();
  const authorize = jest.fn(async () => undefined), verify = jest.fn(async () => { throw new Error("Expired source"); });
  const guard = { authorize, verify } as unknown as AssistantSourceGuard;
  expect(await authorizePersonEventCreationReplay(db, actor, guard)).toBeNull();
  expect(authorize).toHaveBeenCalledWith(tx); expect(verify).not.toHaveBeenCalled(); expect(tx.event.create).not.toHaveBeenCalled();
});
it("an in-transaction completed receipt returns only after renewed authority, without creating or re-verifying", async () => {
  const { tx, db } = setup();
  const cached = { status: 200, body: { event: { id: "previous-event" } } };
  tx.idempotencyRecord.findFirst.mockResolvedValue({ response_status: cached.status, response_body: cached.body });
  const authorize = jest.fn(async () => undefined), verify = jest.fn();
  expect(await createPersonEvent(db, input, actor, "receipt-a", { authorize, verify } as unknown as AssistantSourceGuard)).toEqual(cached);
  expect(authorize).toHaveBeenCalledTimes(1); expect(verify).not.toHaveBeenCalled();
  expect(tx.event.create).not.toHaveBeenCalled(); expect(recordBetaMetric).not.toHaveBeenCalled();
});
