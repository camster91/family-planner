/** Browser-safe protocol metadata. Never credentials or selected-profile auth. */
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
export const REWARD_ACTION_PROTOCOL = "herewoven.reward-action.v1" as const;
export const REWARD_ACTION_PROTOCOL_HEADER = "X-Herewoven-Reward-Protocol";
export const REWARD_ACTION_OWNER_HEADER = "X-Herewoven-Reward-Owner";
export const REWARD_SOURCE_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RewardActionOwner = { userId: string; familyId: string; role: "parent" | "teen" | "child"; generation: number };
type Common = { protocol: typeof REWARD_ACTION_PROTOCOL; owner: RewardActionOwner; rewardId: string; sourceGeneration: string; issuedAt: number };
export type RewardActionCommand = Common & ({ kind: "claim"; expectedCost: number } | { kind: "approve"; expectedClaimantId: string | null });
export function validRewardActionOwner(value: unknown): value is RewardActionOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.userId === "string" && MEMBER_ID_PATTERN.test(owner.userId)
    && typeof owner.familyId === "string" && MEMBER_ID_PATTERN.test(owner.familyId)
    && typeof owner.role === "string" && ["parent", "teen", "child"].includes(owner.role)
    && typeof owner.generation === "number" && Number.isSafeInteger(owner.generation) && owner.generation >= 0;
}
export function sameRewardActionOwner(left: unknown, right: RewardActionOwner): boolean {
  return validRewardActionOwner(left) && left.userId === right.userId && left.familyId === right.familyId
    && left.role === right.role && left.generation === right.generation;
}
