// Authored UNRUN: same-transaction adapter wiring, not PostgreSQL proof.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("@/lib/notification-event-policy", () => ({ readPrivateNotificationDispatchWindow: jest.fn() }));
jest.mock("@/lib/notification-event-admission", () => ({ admitNotificationEventInTx: jest.fn(async () => ({ kind: "admitted", id: "fixture-event" })) }));
jest.mock("@/lib/notification-recipient-admission", () => ({ admitNotificationRecipientInTx: jest.fn(async () => ({ kind: "created", notificationId: "fixture-notification" })) }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>) => x?.rewards === true }));
import { prepareRewardClaimNotifications, lockRewardClaimNotificationPlan, recordRewardClaimNotificationsInTx } from "../reward-claim-notification-event";
import { readPrivateNotificationDispatchWindow } from "../notification-event-policy";
import { admitNotificationEventInTx } from "../notification-event-admission";
import { admitNotificationRecipientInTx } from "../notification-recipient-admission";
const actor = { userId: "fixture-child", familyId: "fixture-family", role: "child", tokenVersion: 2 };
const plan = { actor, recipients: ["fixture-parent"], windowMs: 60000 };
const claimedAt = new Date("2026-10-25T12:00:00.000Z");
const input = { rewardId: "fixture-reward", transitionId: "5860e58e-8fbf-441b-a416-b8de07de13dc", claimedAt, cost: 10 };
const row = { family_id: actor.familyId, notification_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", notification_claim_id: input.transitionId, claimed_by: actor.userId, claimed_at: claimedAt, cost: 10, name: "Fixture", status: "claimed" };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(60000); });
it("does no new preflight or identity work when the flag is off", async () => {
  jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(null);
  const db = { $transaction: jest.fn() };
  expect(await prepareRewardClaimNotifications(db as any, actor)).toBeNull(); expect(db.$transaction).not.toHaveBeenCalled();
});
it("holds parent roster overflow rather than silently truncating", async () => {
  const tx = { user: { findFirst: jest.fn(async () => ({ id: actor.userId })), findMany: jest.fn(async () => Array.from({ length: 101 }, (_, i) => ({ id: `fixture-parent-${i}` }))) } };
  await expect(prepareRewardClaimNotifications({ $transaction: async (work: any) => work(tx) } as any, actor)).rejects.toThrow("held");
});
it("refuses a changed accepted parent roster before claim effects", async () => {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ ...actor, id: actor.userId, family_id: actor.familyId, token_version: 2 }, { id: "fixture-parent", family_id: actor.familyId, role: "parent" }]).mockResolvedValueOnce([{ features: { rewards: true } }]), user: { findMany: jest.fn(async () => [{ id: "another-parent" }]) } };
  await expect(lockRewardClaimNotificationPlan(tx as any, plan)).rejects.toThrow("held");
});
it("composes event and every frozen recipient in the caller's transaction", async () => {
  const tx = { $queryRaw: jest.fn(async () => [row]) };
  await recordRewardClaimNotificationsInTx(tx as any, plan, input, () => claimedAt);
  expect(admitNotificationEventInTx).toHaveBeenCalledWith(tx, actor, expect.objectContaining({ kind: "reward.claim", transitionId: input.transitionId, sourceGeneration: row.notification_generation }), expect.any(Function), expect.any(Function));
  expect(admitNotificationRecipientInTx).toHaveBeenCalledWith(tx, actor, expect.objectContaining({ slot: 0, userId: "fixture-parent", content: expect.objectContaining({ actionUrl: "/dashboard/rewards?focus=fixture-reward" }) }), expect.any(Function), expect.any(Function));
});
it("throws after recipient refusal so the enclosing claim/XP/receipt can roll back", async () => {
  jest.mocked(admitNotificationRecipientInTx).mockResolvedValueOnce({ kind: "held" } as any);
  await expect(recordRewardClaimNotificationsInTx({ $queryRaw: async () => [row] } as any, plan, input, () => claimedAt)).rejects.toThrow("held");
});
