// Authored UNRUN. Mocked accepted-transition guard; no verify route/PG/provider run.
jest.mock("../notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(), notificationEventAdmissionEnabled: () => true }));
jest.mock("../notification-recipient-admission", () => ({ admitNotificationRecipientInTx: jest.fn() }));
jest.mock("../chore-member-subject", () => ({ eligibleChoreAssigneeInTx: jest.fn(async () => ({ assigned_to: "fixture-child" })) }));
jest.mock("../features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>, key: string) => x[key] === true }));
import { deliverChoreCheckNotificationEventInTx } from "../chore-check-notification-event";
import { admitNotificationEventInTx } from "../notification-event-admission";
import { admitNotificationRecipientInTx } from "../notification-recipient-admission";
const admit = jest.mocked(admitNotificationEventInTx);
const recipient = jest.mocked(admitNotificationRecipientInTx);
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
const check = { choreId: "fixture-chore", generation: "5b58743a-1f01-40fe-adb1-4628148495cb", recipientId: "fixture-child", title: "Fixture chore", decision: "approve" as const, notes: null, activityId: "accepted-activity", activityAt: new Date("2026-10-25T12:00:00.000Z"), deliverBefore: new Date("2026-10-25T13:00:00.000Z") };
function source(change: Record<string, unknown> = {}, factChange: Record<string, unknown> = {}, gamification = false) {
  const row = { assigned_to: check.recipientId, assigned_member_id: null, member_subject_erased: false, responsibility_generation: check.generation, title: check.title, status: "verified", verified_notes: null, ...change };
  const fact = { user_id: actor.userId, type: "chore_verified", metadata: JSON.stringify({ choreId: check.choreId }), created_at: check.activityAt, ...factChange };
  return { $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
    const text = sql.join(" ");
    if (text.includes('FROM "Family"')) return [{ features: { chores: true, gamification } }];
    if (text.includes('FROM "Chore"')) return [row];
    if (text.includes('FROM "Activity"')) return [fact];
    throw new Error("Unexpected fixture query");
  }), user: { findUnique: jest.fn(async () => ({ level: 3 })) } };
}
beforeEach(() => {
  admit.mockReset(); recipient.mockReset();
  admit.mockImplementation(async (tx, _actor, event, guard) => await guard(tx, event as any) ? { kind: "admitted", id: "event-a" } : { kind: "held" });
  recipient.mockImplementation(async (tx, _actor, _input, guard) => await guard(tx, admit.mock.calls[admit.mock.calls.length - 1][2] as any) ? { kind: "created", notificationId: "notification-a" } : { kind: "held" });
});
it("uses the accepted activity identity/time for verification and preserves reward-category copy", async () => {
  await deliverChoreCheckNotificationEventInTx(source() as any, actor, check);
  expect(admit.mock.calls[0][2]).toMatchObject({ kind: "chore.verification", transitionId: check.activityId, occurredAt: check.activityAt.toISOString(), sourceGeneration: check.generation });
  expect(recipient.mock.calls[0][2]).toMatchObject({ slot: 0, userId: check.recipientId, content: { type: "reward", actionUrl: "/dashboard/chores?focus=fixture-chore" } });
});
it("coalesces an actual current level-up into the same in-app decision only when gamification is on", async () => {
  await deliverChoreCheckNotificationEventInTx(source({}, {}, true) as any, actor, { ...check, levelUpNewLevel: 3 });
  expect(recipient).toHaveBeenCalledTimes(1); expect(recipient.mock.calls[0][2].content.message).toContain("You reached Level 3!");
  recipient.mockClear();
  await deliverChoreCheckNotificationEventInTx(source() as any, actor, { ...check, levelUpNewLevel: 3 });
  expect(recipient.mock.calls[0][2].content.message).not.toContain("Level");
});
it("keeps rejection as a chore notice tied to its own accepted activity", async () => {
  const rejected = { ...check, decision: "reject" as const, notes: "Please check the corners", activityId: "next-rejection-activity" };
  await deliverChoreCheckNotificationEventInTx(source({ status: "pending", verified_notes: rejected.notes }, { type: "chore_rejected" }) as any, actor, rejected);
  expect(admit.mock.calls[0][2]).toMatchObject({ kind: "chore.returned", transitionId: rejected.activityId });
  expect(recipient.mock.calls[0][2].content).toMatchObject({ type: "chore", title: "Have another go" });
});
it.each([{ assigned_to: "other-account" }, { member_subject_erased: true }, { status: "completed" }, { responsibility_generation: "other-generation" }])("holds changed subject/transition state (%s)", async change => {
  await expect(deliverChoreCheckNotificationEventInTx(source(change) as any, actor, check)).rejects.toThrow("event admission held");
  expect(recipient).not.toHaveBeenCalled();
});
it("does not trust activity metadata or a claimed level without matching canonical evidence", async () => {
  await expect(deliverChoreCheckNotificationEventInTx(source({}, { metadata: JSON.stringify({ choreId: "foreign-chore" }) }) as any, actor, check)).rejects.toThrow("event admission held");
  await expect(deliverChoreCheckNotificationEventInTx(source({}, {}, true) as any, actor, { ...check, levelUpNewLevel: 4 })).rejects.toThrow("event admission held");
});
