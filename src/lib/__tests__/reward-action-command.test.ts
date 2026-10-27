// Authored UNRUN: exact original source predicate/contract, not PG/CAS proof.
import { rewardActionCommandSchema, rewardActionOwnerMatches, rewardActionTimeRefusal, checkRewardActionSourceInTx, REWARD_ACTION_PROTOCOL } from "../reward-action-command";
import { IDEMPOTENCY_TTL_MS } from "../idempotency-key";
const now = Date.now();
const command = { protocol: REWARD_ACTION_PROTOCOL, kind: "claim" as const, rewardId: "fixture-reward", sourceGeneration: "5b58743a-1f01-40fe-adb1-4628148495cb", issuedAt: now, expectedCost: 10, owner: { userId: "fixture-child", familyId: "fixture-family", role: "child" as const, generation: 2 } };
const actor = { userId: command.owner.userId, familyId: command.owner.familyId, role: command.owner.role, tokenVersion: 2 };
it("requires original owner, explicit action/review terms and no unknown fields", () => {
  expect(rewardActionCommandSchema.safeParse(command).success).toBe(true);
  expect(rewardActionCommandSchema.safeParse({ ...command, expectedCost: undefined }).success).toBe(false);
  expect(rewardActionCommandSchema.safeParse({ ...command, arbitrary: true }).success).toBe(false);
  expect(rewardActionOwnerMatches(command, { ...actor, tokenVersion: 3 })).toBe(false);
});
it("uses the original server-checked issue window without a renewed retry time", () => {
  expect(rewardActionTimeRefusal(command, now)).toBeNull();
  expect(rewardActionTimeRefusal(command, now - 1)).toMatchObject({ status: 409 });
  expect(rewardActionTimeRefusal(command, now + IDEMPOTENCY_TTL_MS)).toMatchObject({ status: 410 });
});
it("holds a recreated/repriced source via one locked birth-and-cost predicate", async () => {
  const tx = { $queryRaw: jest.fn(async () => []) };
  expect(await checkRewardActionSourceInTx(tx as any, { ...command, issuedAt: Date.now() - 1000 }, actor)).toMatchObject({ status: 409, body: { code: "REWARD_COMMAND_SOURCE_CHANGED" } });
  const [sql, id, family, generation, cost] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string, string, string, number];
  expect(sql.join("?")).toContain('"cost" = ? FOR UPDATE'); expect([id, family, generation, cost]).toEqual([command.rewardId, actor.familyId, command.sourceGeneration, 10]);
});
