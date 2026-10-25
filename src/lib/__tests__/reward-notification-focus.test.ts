// Authored UNRUN: scoped projection only, not actual PG/concurrency/privacy proof.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>) => x?.rewards === true }));
import { readRewardNotificationFocus } from "../reward-notification-focus";
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
const row = { id: "fixture-reward", name: "Fixture reward", description: null, cost: 10, icon: "gift", status: "claimed", is_active: true, claimed_by: "fixture-child" };
function setup(role = owner.role) {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ family_id: owner.familyId, role, token_version: 2 }]).mockResolvedValueOnce([{ features: { rewards: true } }]).mockResolvedValueOnce([{ id: row.id }]), reward: { findFirst: jest.fn(async () => row) } };
  return { tx, db: { $transaction: jest.fn(async (work: (tx: any) => unknown) => work(tx)) } };
}
it("reads one current household claim without unrelated names/history/balance", async () => {
  const { tx, db } = setup();
  expect(await readRewardNotificationFocus(db as any, owner, row.id)).toEqual({ id: row.id, name: row.name, description: null, cost: 10, icon: "gift", status: "claimed", active: true, claimedById: row.claimed_by, claimedByName: null });
  expect(tx.reward.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: row.id, family_id: owner.familyId }) }));
});
it("restricts child and teen focus to their own account claims", async () => {
  for (const role of ["child", "teen"]) {
    const { tx, db } = setup(role);
    await readRewardNotificationFocus(db as any, { ...owner, role }, row.id);
    expect(tx.reward.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimed_by: owner.userId }) }));
  }
});
it("holds a revoked original session before target reads", async () => {
  const { tx, db } = setup(); tx.$queryRaw.mockReset().mockResolvedValue([{ family_id: owner.familyId, role: owner.role, token_version: 3 }]);
  expect(await readRewardNotificationFocus(db as any, owner, row.id)).toBeNull(); expect(tx.reward.findFirst).not.toHaveBeenCalled();
});
it("gives malformed, missing, foreign or disabled targets the same neutral result", async () => {
  const invalid = setup(); expect(await readRewardNotificationFocus(invalid.db as any, owner, [row.id])).toBeNull(); expect(invalid.db.$transaction).not.toHaveBeenCalled();
  const missing = setup(); missing.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ family_id: owner.familyId, role: owner.role, token_version: 2 }]).mockResolvedValueOnce([{ features: { rewards: true } }]).mockResolvedValueOnce([]);
  expect(await readRewardNotificationFocus(missing.db as any, owner, row.id)).toBeNull(); expect(missing.tx.reward.findFirst).not.toHaveBeenCalled();
  const disabled = setup(); disabled.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ family_id: owner.familyId, role: owner.role, token_version: 2 }]).mockResolvedValueOnce([{ features: { rewards: false } }]);
  expect(await readRewardNotificationFocus(disabled.db as any, owner, row.id)).toBeNull(); expect(disabled.tx.reward.findFirst).not.toHaveBeenCalled();
});
