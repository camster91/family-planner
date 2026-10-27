// Authored UNRUN: original-authority read scope only, not actual SQL/isolation.
jest.mock("@/lib/reward-mutations", () => ({ authorizeRewardActorInTx: jest.fn() }));
import { withRewardReadAccess } from "../reward-read-access";
import { authorizeRewardActorInTx } from "../reward-mutations";
const authorize = jest.mocked(authorizeRewardActorInTx);
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent", tokenVersion: 2 };
beforeEach(() => authorize.mockReset().mockResolvedValue(null));
it("uses the supplied original actor and transaction for canonical reads", async () => {
  const tx = {}; const db = { $transaction: jest.fn(async (work: any) => work(tx)) }; const read = jest.fn(async () => ({ rewards: ["fixture"] }));
  expect(await withRewardReadAccess(db as any, owner, read)).toEqual({ kind: "data", value: { rewards: ["fixture"] } });
  expect(authorize).toHaveBeenCalledWith(tx, owner, false); expect(read).toHaveBeenCalledWith(tx);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000, maxWait: 5000 });
});
it("does not query private data after original authority refusal", async () => {
  authorize.mockResolvedValue({ status: 401, body: { error: "Unauthorized" } });
  const read = jest.fn(); const db = { $transaction: async (work: any) => work({}) };
  expect(await withRewardReadAccess(db as any, owner, read)).toMatchObject({ kind: "held", result: { status: 401 } }); expect(read).not.toHaveBeenCalled();
});
it("never upgrades a missing original session from later database values", async () => {
  const db = { $transaction: jest.fn() };
  expect(await withRewardReadAccess(db as any, { ...owner, tokenVersion: undefined }, jest.fn())).toMatchObject({ kind: "held" });
  expect(db.$transaction).not.toHaveBeenCalled();
});
