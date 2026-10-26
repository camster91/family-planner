// Authored UNRUN: authority/receipt ordering, not PG or live session proof.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("@/lib/reward-claim-notification-event", () => ({ prepareRewardClaimNotifications: async () => null }));
jest.mock("@/lib/reward-approval-notification-event", () => ({ prepareRewardApprovalNotifications: async () => null }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>) => x?.rewards === true }));
import { authorizeRewardActorInTx, createReward } from "../reward-mutations";
const actor = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
function setup() {
  const tx = { $queryRaw: jest.fn(async () => []), user: { findUnique: jest.fn(async () => ({ id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: 2 })) }, family: { findUnique: jest.fn(async () => ({ id: actor.familyId, features: { rewards: true } })) }, idempotencyRecord: { findFirst: jest.fn(async () => ({ response_status: 200, response_body: { reward: { name: "Private fixture" } } })) }, reward: { create: jest.fn() } };
  return { tx, db: { $transaction: async (work: any) => work(tx) } };
}
it("renews the original session and actual principal/feature rows", async () => {
  const { tx } = setup(); expect(await authorizeRewardActorInTx(tx as any, actor, true)).toBeNull();
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ token_version: true }) }));
});
it("refuses a changed generation before reading a stored private receipt", async () => {
  const { tx, db } = setup(); tx.user.findUnique.mockResolvedValue({ id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: 3 });
  const result = await createReward(db as any, { name: "Fixture", cost: 10 } as any, actor, "fixture-receipt");
  expect(result.applied).toBe(false); expect(result.result.status).toBe(401);
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled(); expect(tx.reward.create).not.toHaveBeenCalled();
});
it("refuses a changed original role even when the operation is not parent-only", async () => {
  const { tx } = setup(); tx.user.findUnique.mockResolvedValue({ id: actor.userId, family_id: actor.familyId, role: "child", token_version: 2 });
  expect(await authorizeRewardActorInTx(tx as any, actor, false)).toMatchObject({ status: 401 });
});
