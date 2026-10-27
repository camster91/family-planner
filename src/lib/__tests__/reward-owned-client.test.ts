// Authored UNRUN: response admission, not server authority proof.
import { ownedRewardReadMatches, rewardProtocolAcknowledged } from "../reward-owned-client";
import { REWARD_ACTION_PROTOCOL, REWARD_ACTION_PROTOCOL_HEADER } from "../reward-action-shared";
const owner = { userId: "fixture-child", familyId: "fixture-family", role: "child" as const, generation: 2 };
const row = { id: "fixture-reward", family_id: owner.familyId, notification_generation: "5b58743a-1f01-40fe-adb1-4628148495cb", name: "Fixture", cost: 10, is_active: true, status: "claimed", claimed_by: owner.userId };
it("requires protocol acknowledgement and original owner/target scope", () => {
  expect(rewardProtocolAcknowledged({ headers: new Headers({ [REWARD_ACTION_PROTOCOL_HEADER]: REWARD_ACTION_PROTOCOL }) })).toBe(true);
  expect(rewardProtocolAcknowledged({})).toBe(false);
  expect(ownedRewardReadMatches({ protocol: REWARD_ACTION_PROTOCOL, owner, rewards: [row] }, owner, row.id)).toBe(true);
  expect(ownedRewardReadMatches({ protocol: REWARD_ACTION_PROTOCOL, owner: { ...owner, generation: 3 }, rewards: [row] }, owner, row.id)).toBe(false);
  expect(ownedRewardReadMatches({ protocol: REWARD_ACTION_PROTOCOL, owner, rewards: [{ ...row, family_id: "other-family" }] }, owner, row.id)).toBe(false);
});
it("holds future status/unsupported birth evidence and excess targets", () => {
  for (const rewards of [[{ ...row, status: "future" }], [{ ...row, notification_generation: undefined }], [row, row]])
    expect(ownedRewardReadMatches({ protocol: REWARD_ACTION_PROTOCOL, owner, rewards }, owner, row.id)).toBe(false);
});
