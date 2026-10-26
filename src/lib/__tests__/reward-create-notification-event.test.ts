// Authored UNRUN: birth adapter composition, not actual transaction/SQL proof.
jest.mock("@/lib/reward-notification-roster", () => ({ prepareRewardNotificationRoster: jest.fn(), lockRewardNotificationRoster: jest.fn() }));
jest.mock("@/lib/notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(async () => ({ kind: "admitted", id: "fixture-event" })) }));
jest.mock("@/lib/notification-recipient-admission", () => ({ admitNotificationRecipientInTx: jest.fn(async () => ({ kind: "created", notificationId: "fixture-notification" })) }));
import { prepareRewardCreationNotifications, recordRewardCreationNotificationsInTx } from "../reward-create-notification-event";
import { prepareRewardNotificationRoster } from "../reward-notification-roster";
import { admitNotificationEventInTx } from "../notification-event-admission";
import { admitNotificationRecipientInTx } from "../notification-recipient-admission";
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
const plan = { actor, recipients: ["fixture-child", "fixture-teen"], windowMs: 60000 };
const birth = { id: "fixture-reward", family_id: actor.familyId, created_by: actor.userId, notification_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", created_at: new Date("2026-10-25T12:00:00.000Z"), name: "Fixture", cost: 10 };
beforeEach(() => jest.clearAllMocks());
it("uses its own private readiness flags and creator-excluded roster", async () => {
  await prepareRewardCreationNotifications({} as any, actor);
  expect(prepareRewardNotificationRoster).toHaveBeenCalledWith({}, actor, "others", "REWARD_CREATE_NOTIFICATION_EVENTS_ENABLED", "REWARD_CREATE_NOTIFICATION_DISPATCH_MS");
});
it("records one actual birth and the entire accepted roster in the caller transaction", async () => {
  const tx = {};
  await recordRewardCreationNotificationsInTx(tx as any, plan, birth, () => birth.created_at);
  expect(admitNotificationEventInTx).toHaveBeenCalledWith(tx, actor, expect.objectContaining({ kind: "reward.created", sourceGeneration: birth.notification_generation, transitionId: "created" }), expect.any(Function), expect.any(Function));
  expect(admitNotificationRecipientInTx).toHaveBeenCalledTimes(2);
  expect(jest.mocked(admitNotificationRecipientInTx).mock.calls.map(call => [call[2].slot, call[2].userId])).toEqual([[0, "fixture-child"], [1, "fixture-teen"]]);
});
it("seals an empty roster and throws after a recipient hold for enclosing rollback", async () => {
  await recordRewardCreationNotificationsInTx({} as any, { ...plan, recipients: [] }, birth, () => birth.created_at);
  expect(admitNotificationRecipientInTx).toHaveBeenCalledWith({}, actor, expect.objectContaining({ slot: 0, userId: null }), expect.any(Function), expect.any(Function));
  jest.mocked(admitNotificationRecipientInTx).mockResolvedValueOnce({ kind: "held" } as any);
  await expect(recordRewardCreationNotificationsInTx({} as any, plan, birth, () => birth.created_at)).rejects.toThrow("held");
});
