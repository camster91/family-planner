// Authored UNRUN: original review/version contract only, not SQL/ABA proof.
import { CHORE_CHECK_COMMAND_PROTOCOL, CHORE_CHECK_EPOCH_MAX, choreCheckSnapshot, sameChoreCheckSnapshot } from "../chore-check-command-shared";
import { choreCheckCommandSchema, choreCheckOwnerMatches, lockOriginalChoreCheckInTx } from "../chore-check-command";
const row = { status: "completed", responsibility_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", responsibility_epoch: 2, preparation_epoch: 7 };
const expected = choreCheckSnapshot(row)!;
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent" as const, generation: 3 };
const body = { protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner, choreId: "fixture-chore", expected, decision: "approve" };
it("distinguishes a later completion even when timestamp/title are reused", () => {
  expect(sameChoreCheckSnapshot(expected, choreCheckSnapshot({ ...row, preparation_epoch: 9 })!)).toBe(false);
  expect(sameChoreCheckSnapshot(expected, choreCheckSnapshot({ ...row, responsibility_epoch: 3 })!)).toBe(false);
  expect(sameChoreCheckSnapshot(expected, { ...expected, generation: "other-generation" })).toBe(false);
});
it("withholds missing/defaulted/saturated versions and rows no longer waiting for review", () => {
  for (const input of [{ ...row, preparation_epoch: undefined }, { ...row, preparation_epoch: CHORE_CHECK_EPOCH_MAX }, { ...row, responsibility_epoch: -1 }, { ...row, responsibility_generation: "fixture-chore" }, { ...row, status: "verified" }])
    expect(choreCheckSnapshot(input)).toBeNull();
  expect(choreCheckCommandSchema.safeParse({ ...body, expected: { ...expected, completionEpoch: CHORE_CHECK_EPOCH_MAX } }).success).toBe(false);
});
it("requires explicit version/decision/owner and never trusts an owner as authentication", () => {
  expect(choreCheckCommandSchema.safeParse(body).success).toBe(true);
  expect(choreCheckCommandSchema.safeParse({ ...body, decision: undefined }).success).toBe(false);
  expect(choreCheckCommandSchema.safeParse({ ...body, extra: "ignored instruction" }).success).toBe(false);
  expect(choreCheckOwnerMatches(owner, { userId: owner.userId, familyId: owner.familyId, role: "parent", tokenVersion: 3 })).toBe(true);
  expect(choreCheckOwnerMatches(owner, { userId: owner.userId, familyId: "other-family", role: "parent", tokenVersion: 3 })).toBe(false);
});
it("compares the complete original source in the same row-locking predicate", async () => {
  const tx = { $queryRaw: jest.fn(async () => [{ id: body.choreId }]) };
  expect(await lockOriginalChoreCheckInTx(tx as any, owner.familyId, body.choreId, expected)).toBe(true);
  expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([body.choreId, owner.familyId, expected.generation, expected.materialEpoch, expected.completionEpoch]);
  tx.$queryRaw.mockResolvedValue([]);
  expect(await lockOriginalChoreCheckInTx(tx as any, owner.familyId, body.choreId, expected)).toBe(false);
});
