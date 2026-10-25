// Authored UNRUN. Required canonical-source callback, not PG or producer proof.
import { recordChoreCreationNotificationEventInTx } from "../chore-create-notification-event";
import { admitNotificationEventInTx, notificationEventAdmissionEnabled } from "../notification-event-admission";
jest.mock("../notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(), notificationEventAdmissionEnabled: jest.fn() }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (value: unknown) => value, isFeatureEnabled: (value: Record<string, boolean>, key: string) => value?.[key] === true }));
const admit = jest.mocked(admitNotificationEventInTx);
const enabled = jest.mocked(notificationEventAdmissionEnabled);
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 4 };
const created = { id: "fixture-chore", family_id: actor.familyId, created_by: actor.userId, assigned_to: "fixture-child-account", responsibility_generation: "eb8be42a-4875-4d31-b246-090bcd165d7e", created_at: new Date("2026-10-25T12:00:00.000Z") };
const deadline = new Date("2026-10-25T13:00:00.000Z");
const clock = () => new Date("2026-10-25T12:30:00.000Z");
function txFor(change = {}) {
  return { $queryRaw: jest.fn().mockResolvedValueOnce([{ features: { chores: true } }]).mockResolvedValueOnce([{ ...created, status: "pending", member_subject_erased: false, ...change }]) };
}
beforeEach(() => {
  enabled.mockReturnValue(true); admit.mockReset();
  admit.mockImplementation(async (tx, _actor, _input, guard) => await guard(tx, _input as any) ? { kind: "admitted", id: "event-a" } : { kind: "held" });
});
it("derives creation identity from the actual birth generation/time and guards the locked canonical source", async () => {
  const tx = txFor();
  expect(await recordChoreCreationNotificationEventInTx(tx as any, actor, created, deadline, clock)).toEqual({ kind: "admitted", id: "event-a" });
  expect(admit.mock.calls[0][2]).toMatchObject({ sourceId: created.id, sourceGeneration: created.responsibility_generation, transitionId: "created", occurredAt: created.created_at.toISOString(), deliverBefore: deadline.toISOString() });
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([created.id, actor.familyId]);
});
it.each([{ assigned_to: "changed-account" }, { responsibility_generation: "e1474307-eccc-494c-8495-c4879a2f8610" }, { created_at: new Date("2026-10-25T11:00:00.000Z") }, { status: "completed" }, { member_subject_erased: true }])("holds changed or erased source (%s)", async change => {
  expect(await recordChoreCreationNotificationEventInTx(txFor(change) as any, actor, created, deadline, clock)).toEqual({ kind: "held" });
});
it("holds a disabled feature before reading source details", async () => {
  const tx = txFor(); tx.$queryRaw.mockReset().mockResolvedValue([{ features: { chores: false } }]);
  expect(await recordChoreCreationNotificationEventInTx(tx as any, actor, created, deadline, clock)).toEqual({ kind: "held" });
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
});
it("holds disabled admission, nonparent, foreign birth and account-free assignee before storage", async () => {
  const tx = txFor(); enabled.mockReturnValue(false);
  await recordChoreCreationNotificationEventInTx(tx as any, actor, created, deadline, clock);
  enabled.mockReturnValue(true);
  await recordChoreCreationNotificationEventInTx(tx as any, { ...actor, role: "teen" }, created, deadline, clock);
  await recordChoreCreationNotificationEventInTx(tx as any, actor, { ...created, family_id: "other-family" }, deadline, clock);
  await recordChoreCreationNotificationEventInTx(tx as any, actor, { ...created, assigned_to: null }, deadline, clock);
  expect(admit).not.toHaveBeenCalled(); expect(tx.$queryRaw).not.toHaveBeenCalled();
});
