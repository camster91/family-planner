/** Response admission only. No write fallback, auth inferred from echoes or retry. */
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { REWARD_ACTION_PROTOCOL, REWARD_ACTION_PROTOCOL_HEADER, REWARD_SOURCE_GENERATION,
  sameRewardActionOwner, type RewardActionOwner } from "@/lib/reward-action-shared";
export function rewardProtocolAcknowledged(response: { headers?: Pick<Headers, "get"> }): boolean {
  return response.headers?.get(REWARD_ACTION_PROTOCOL_HEADER) === REWARD_ACTION_PROTOCOL;
}
export function ownedRewardReadMatches(body: unknown, owner: RewardActionOwner, rewardId: string): boolean {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  if (value.protocol !== REWARD_ACTION_PROTOCOL || !sameRewardActionOwner(value.owner, owner)
      || !Array.isArray(value.rewards) || value.rewards.length > 1) return false;
  return value.rewards.every(row => row && typeof row === "object" && row.id === rewardId && row.family_id === owner.familyId
    && typeof row.notification_generation === "string" && REWARD_SOURCE_GENERATION.test(row.notification_generation)
    && typeof row.name === "string" && Number.isSafeInteger(row.cost) && row.cost >= 0 && typeof row.is_active === "boolean"
    && ["available", "claimed", "approved", "redeemed"].includes(row.status)
    && (row.claimed_by === null || (typeof row.claimed_by === "string" && MEMBER_ID_PATTERN.test(row.claimed_by))));
}
