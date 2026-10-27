// Authored UNRUN: complete bounded roster policy, not actual membership races.
jest.mock("@/lib/notification-event-policy", () => ({ readPrivateNotificationDispatchWindow: jest.fn() }));
jest.mock("@/lib/reward-notification-owner", () => ({ lockRewardNotificationParticipants: jest.fn() }));
import { prepareRewardNotificationRoster, lockRewardNotificationRoster } from "../reward-notification-roster";
import { readPrivateNotificationDispatchWindow } from "../notification-event-policy";
import { lockRewardNotificationParticipants } from "../reward-notification-owner";
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(60000); });
it("does no roster read with the cohort off", async () => {
  jest.mocked(readPrivateNotificationDispatchWindow).mockReturnValue(null); const db = { $transaction: jest.fn() };
  expect(await prepareRewardNotificationRoster(db as any, actor, "others", "fixture-flag", "fixture-window")).toBeNull(); expect(db.$transaction).not.toHaveBeenCalled();
});
it("captures at most100 others, freezing the creator-excluded list", async () => {
  const tx = { user: { findFirst: async () => ({ id: actor.userId }), findMany: jest.fn(async () => [{ id: "fixture-child" }]) } };
  const result = await prepareRewardNotificationRoster({ $transaction: async (work: any) => work(tx) } as any, actor, "others", "fixture-flag", "fixture-window");
  expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id: actor.familyId, id: { not: actor.userId } }, take: 101 }));
  expect(Object.isFrozen(result?.recipients)).toBe(true);
});
it("holds complete-roster drift after participant locks", async () => {
  jest.mocked(lockRewardNotificationParticipants).mockResolvedValue([{ id: "fixture-child", family_id: actor.familyId, role: "child", token_version: 0 }]);
  const tx = { user: { findMany: async () => [{ id: "new-recipient" }] } };
  await expect(lockRewardNotificationRoster(tx as any, { actor, recipients: ["fixture-child"], windowMs: 60000 }, "others")).rejects.toThrow("held");
});
