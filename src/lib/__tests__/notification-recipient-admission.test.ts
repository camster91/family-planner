// Authored UNRUN; atomicity/SQL/FK/concurrency require later PostgreSQL evidence.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("../notification-event-admission", () => ({ notificationEventAdmissionEnabled: jest.fn(() => true) }));
jest.mock("../notification-delivery", () => ({ deliverNotificationInTx: jest.fn() }));
import { admitNotificationRecipientInTx } from "../notification-recipient-admission";
import { notificationEventAdmissionEnabled } from "../notification-event-admission";
import { deliverNotificationInTx } from "../notification-delivery";
import { NOTIFICATION_EVENT_PROTOCOL } from "../notification-event-contract";
const deliver = jest.mocked(deliverNotificationInTx);
const enabled = jest.mocked(notificationEventAdmissionEnabled);
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 4 };
const event = { protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: actor.familyId, kind: "chore.assignment", sourceId: "fixture-chore", sourceGeneration: "ae6db9ce-4082-4f7d-b1cb-e1dba3e9a8fa", transitionId: "created", occurredAt: "2026-10-25T12:00:00.000Z", deliverBefore: "2026-10-25T13:00:00.000Z" };
const input = { eventId: "event-a", slot: 0, userId: "fixture-child", content: { title: "Assigned", message: "Fixture chore assigned", type: "chore" as const } };
const clock = () => new Date("2026-10-25T12:30:00.000Z");
function txFor(prior: unknown = null) {
  return { $queryRaw: jest.fn().mockResolvedValueOnce([
    { id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: 4 },
    { id: input.userId, family_id: actor.familyId, role: "child", token_version: 1 },
  ]).mockResolvedValueOnce([{ envelope: event }]),
  notificationEventOccurrence: { findFirst: jest.fn(async () => ({ envelope: event })) },
  notificationRecipientDecision: { findUnique: jest.fn(async () => prior), create: jest.fn(async () => ({})) } };
}
beforeEach(() => { enabled.mockReturnValue(true); deliver.mockReset(); deliver.mockResolvedValue({ delivered: true, notification: { id: "notification-a" }, quiet: false } as any); });
it("creates one current notification and terminal decision in the supplied effect transaction", async () => {
  const tx = txFor(); const guard = jest.fn(async () => true);
  expect(await admitNotificationRecipientInTx(tx as any, actor, input, guard, clock)).toEqual({ kind: "created", notificationId: "notification-a" });
  expect(guard).toHaveBeenCalledWith(tx, event);
  expect(deliver).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: input.userId, familyId: actor.familyId, senderId: actor.userId, type: "chore" }), clock());
  expect(tx.notificationRecipientDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event_id: input.eventId, slot: 0, user_id: input.userId, status: "created", notification_id: "notification-a" }) });
});
it("does not resend when an inbox item was deleted but its completed decision remains", async () => {
  const tx = txFor({ family_id: actor.familyId, user_id: input.userId, status: "created", notification_id: null });
  expect(await admitNotificationRecipientInTx(tx as any, actor, input, async () => true, clock)).toEqual({ kind: "existing", notificationId: null });
  expect(deliver).not.toHaveBeenCalled(); expect(tx.notificationRecipientDecision.create).not.toHaveBeenCalled();
});
it("records preference suppression as terminal and does not adopt an erased recipient slot", async () => {
  deliver.mockResolvedValue({ delivered: false, notification: null } as any);
  const tx = txFor();
  expect(await admitNotificationRecipientInTx(tx as any, actor, input, async () => true, clock)).toEqual({ kind: "suppressed", notificationId: null });
  expect(tx.notificationRecipientDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "suppressed", notification_id: null }) });
  deliver.mockClear();
  const erased = txFor({ family_id: actor.familyId, user_id: null, status: "created", notification_id: null });
  expect(await admitNotificationRecipientInTx(erased as any, actor, input, async () => true, clock)).toEqual({ kind: "held" });
  expect(deliver).not.toHaveBeenCalled();
});
it("holds source refusal and changed sender generation before delivery", async () => {
  const tx = txFor();
  expect(await admitNotificationRecipientInTx(tx as any, actor, input, async () => false, clock)).toEqual({ kind: "held" });
  expect(tx.notificationRecipientDecision.findUnique).not.toHaveBeenCalled();
  const stale = txFor(); stale.$queryRaw.mockReset().mockResolvedValue([{ id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: 5 }]);
  const guard = jest.fn(async () => true);
  expect(await admitNotificationRecipientInTx(stale as any, actor, input, guard, clock)).toEqual({ kind: "held" });
  expect(guard).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
});
it("does not dispatch unsupported content/type or unsafe destinations", async () => {
  const tx = txFor();
  expect(await admitNotificationRecipientInTx(tx as any, actor, { ...input, content: { ...input.content, actionUrl: "https://fixture.invalid" } }, async () => true, clock)).toEqual({ kind: "held" });
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(await admitNotificationRecipientInTx(tx as any, actor, { ...input, content: { ...input.content, type: "summary" } }, async () => true, clock)).toEqual({ kind: "held" });
  expect(deliver).not.toHaveBeenCalled();
});
it("forces enclosing rollback if the deadline passes after row creation", async () => {
  const times = [clock(), clock(), clock(), new Date(event.deliverBefore)];
  await expect(admitNotificationRecipientInTx(txFor() as any, actor, input, async () => true, () => times.shift()!)).rejects.toThrow("recipient admission held");
});
it("keeps default-off admission out of the storage/delivery path", async () => {
  enabled.mockReturnValue(false); const tx = txFor();
  expect(await admitNotificationRecipientInTx(tx as any, actor, input, async () => true, clock)).toEqual({ kind: "held" });
  expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
});

// Authored UNRUN: only accepted reward-claim events permit a nonparent producer.
it("holds child producers for chore events before central delivery", async () => {
  const tx = txFor(); tx.$queryRaw.mockReset().mockResolvedValue([
    { id: actor.userId, family_id: actor.familyId, role: "child", token_version: 4 },
    { id: input.userId, family_id: actor.familyId, role: "parent", token_version: 1 },
  ]);
  expect(await admitNotificationRecipientInTx(tx as any, { ...actor, role: "child" }, input, async () => true, clock)).toEqual({ kind: "held" });
  expect(deliver).not.toHaveBeenCalled();
});
it("admits an own accepted claim from a child only to a current parent", async () => {
  const claimEvent = { ...event, kind: "reward.claim" };
  const tx = txFor(); tx.notificationEventOccurrence.findFirst.mockResolvedValue({ envelope: claimEvent } as any);
  tx.$queryRaw.mockReset().mockResolvedValueOnce([
    { id: actor.userId, family_id: actor.familyId, role: "child", token_version: 4 },
    { id: input.userId, family_id: actor.familyId, role: "parent", token_version: 1 },
  ]).mockResolvedValueOnce([{ envelope: claimEvent }]);
  expect(await admitNotificationRecipientInTx(tx as any, { ...actor, role: "child" }, { ...input, content: { ...input.content, type: "reward" } }, async () => true, clock)).toMatchObject({ kind: "created" });
});
