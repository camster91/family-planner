// Authored UNRUN: lock/read scope only, not PG concurrency or token proof.
jest.mock("@/lib/household-lock", () => ({ lockUser: jest.fn(), lockHousehold: jest.fn() }));
jest.mock("@/lib/features", () => ({ normalizeFeatures: (x: unknown) => x, isFeatureEnabled: (x: Record<string, boolean>) => x?.chores === true }));
import { choreCheckOwnerAvailableInTx } from "../chore-check-owner";
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent" as const, generation: 2 };
it("requires the exact current parent/family/session and feature", async () => {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ family_id: owner.familyId, role: owner.role, token_version: 2 }]).mockResolvedValueOnce([{ features: { chores: true } }]) };
  expect(await choreCheckOwnerAvailableInTx(tx as any, owner)).toBe(true);
  expect(tx.$queryRaw.mock.calls[0][1]).toBe(owner.userId); expect(tx.$queryRaw.mock.calls[1][1]).toBe(owner.familyId);
});
it("does not read family content for a changed original generation", async () => {
  const tx = { $queryRaw: jest.fn(async () => [{ family_id: owner.familyId, role: owner.role, token_version: 3 }]) };
  expect(await choreCheckOwnerAvailableInTx(tx as any, owner)).toBe(false); expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
});
