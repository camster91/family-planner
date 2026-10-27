// Authored UNRUN. Transaction composition contracts only; no SQL/rollback proof.
jest.mock("@/lib/notification-event-policy", () => ({ readPrivateNotificationDispatchWindow: jest.fn() }));
jest.mock("@/lib/reward-notification-owner", () => ({ lockRewardNotificationParticipants: jest.fn() }));
jest.mock("@/lib/notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(async () => ({ kind: "admitted", id: "fixture-event" })) }));
jest.mock("@/lib/notification-recipient-admission", () => ({ admitNotificationRecipientInTx: jest.fn(async () => ({ kind: "created", notificationId: "fixture-notification" })) }));
import { prepareRewardApprovalNotifications, lockRewardApprovalNotificationPlan, recordRewardApprovalNotificationInTx } from "../reward-approval-notification-event";
import { readPrivateNotificationDispatchWindow } from "../notification-event-policy";
import { lockRewardNotificationParticipants } from "../reward-notification-owner";
import { admitNotificationRecipientInTx } from "../notification-recipient-admission";
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
const plan = { actor, claimantId: "fixture-child", windowMs: 60000 };
const approvedAt = new Date("2026-10-25T12:00:00.000Z");
const input = { rewardId: "fixture-reward", transitionId: "5860e58e-8fbf-441b-a416-b8de07de13dc", approvedAt, recipientId: plan.claimantId };
const row = { notification_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", notification_approval_id: input.transitionId, claimed_by: plan.claimantId, approved_by: actor.userId, approved_at: approvedAt, approved: true, name: "Fixture", status: "redeemed" };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(60000); });
it("does no candidate work in disabled mode and refuses claimed nonparents in enabled mode", async () => {
  const db = { $transaction: jest.fn() };
  jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(null);
  expect(await prepareRewardApprovalNotifications(db as any, actor, input.rewardId)).toBeNull(); expect(db.$transaction).not.toHaveBeenCalled();
  jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(60000);
  await expect(prepareRewardApprovalNotifications(db as any, { ...actor, role: "child" }, input.rewardId)).rejects.toThrow("held");
});
it("keeps departed claimants out of the notification recipient projection", async () => {
  jest.mocked(lockRewardNotificationParticipants).mockResolvedValue([{ id: plan.claimantId, family_id: "another-family", role: "child", token_version: 1 }]);
  expect(await lockRewardApprovalNotificationPlan({} as any, plan)).toBeNull();
});
it("composes an exact original approval event and claimant slot in the supplied transaction", async () => {
  const tx = { $queryRaw: async () => [row] };
  await recordRewardApprovalNotificationInTx(tx as any, plan, input, () => approvedAt);
  expect(admitNotificationRecipientInTx).toHaveBeenCalledWith(tx, actor, expect.objectContaining({ userId: plan.claimantId, slot: 0, content: expect.objectContaining({ actionUrl: "/dashboard/rewards?focus=fixture-reward" }) }), expect.any(Function), expect.any(Function));
});
it("records an empty terminal slot rather than leaving later recipient adoption possible", async () => {
  const tx = { $queryRaw: async () => [row] };
  await recordRewardApprovalNotificationInTx(tx as any, plan, { ...input, recipientId: null }, () => approvedAt);
  expect(admitNotificationRecipientInTx).toHaveBeenCalledWith(tx, actor, expect.objectContaining({ userId: null, slot: 0 }), expect.any(Function), expect.any(Function));
});
it("throws on recipient refusal so approval and receipt cannot partially commit", async () => {
  jest.mocked(admitNotificationRecipientInTx).mockResolvedValueOnce({ kind: "held" } as any);
  await expect(recordRewardApprovalNotificationInTx({ $queryRaw: async () => [row] } as any, plan, input, () => approvedAt)).rejects.toThrow("held");
});
