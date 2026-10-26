/** Browser-safe, in-memory original claim/approval request. A local age check
 * never proves server receipt retention or a mutation's outcome.
 */
import { IDEMPOTENCY_TTL_MS, newIdempotencyKey, isValidIdempotencyKey } from "@/lib/idempotency-key";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
export type RewardRetryIntent = Readonly<{
  kind: "claim" | "approve"; rewardId: string; key: string; issuedAt: number; body: string;
}>;
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function createRewardRetryIntent(rewardId: string, kind: RewardRetryIntent["kind"], issuedAt = Date.now()): RewardRetryIntent {
  if (typeof rewardId !== "string" || !MEMBER_ID_PATTERN.test(rewardId) || !["claim", "approve"].includes(kind) || !validTime(issuedAt))
    throw new Error("Reward request unavailable");
  return Object.freeze({ kind, rewardId, key: newIdempotencyKey(), issuedAt, body: JSON.stringify({ rewardId }) });
}
export function rewardRetryWithinWindow(intent: RewardRetryIntent, now = Date.now()): boolean {
  return ["claim", "approve"].includes(intent.kind) && typeof intent.rewardId === "string" && MEMBER_ID_PATTERN.test(intent.rewardId)
    && isValidIdempotencyKey(intent.key) && intent.body === JSON.stringify({ rewardId: intent.rewardId })
    && validTime(intent.issuedAt) && validTime(now) && now >= intent.issuedAt && now - intent.issuedAt < IDEMPOTENCY_TTL_MS;
}
export function sameRewardRetryIntent(left: RewardRetryIntent, right: RewardRetryIntent): boolean {
  return left.kind === right.kind && left.rewardId === right.rewardId && left.key === right.key
    && left.body === right.body && left.issuedAt === right.issuedAt;
}
