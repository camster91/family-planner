/** Browser-safe in-memory original request. Local age is never receipt proof. */
import { IDEMPOTENCY_TTL_MS, newIdempotencyKey, isValidIdempotencyKey } from "@/lib/idempotency-key";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { REWARD_ACTION_PROTOCOL, REWARD_SOURCE_GENERATION, validRewardActionOwner,
  type RewardActionOwner, type RewardActionCommand } from "@/lib/reward-action-shared";
export type RewardRetryIntent = Readonly<{
  kind: "claim" | "approve"; rewardId: string; key: string; issuedAt: number; body: string;
  command?: Readonly<RewardActionCommand>;
}>;
export type OwnedRewardReview = { owner: RewardActionOwner; sourceGeneration: string; expectedCost?: number; expectedClaimantId?: string | null };
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;
function validCommand(command: RewardActionCommand) {
  return command.protocol === REWARD_ACTION_PROTOCOL && validRewardActionOwner(command.owner)
    && typeof command.sourceGeneration === "string" && REWARD_SOURCE_GENERATION.test(command.sourceGeneration)
    && (command.kind === "claim" ? Number.isSafeInteger(command.expectedCost) && command.expectedCost >= 1 && command.expectedCost <= 100000
      : command.kind === "approve" && command.owner.role === "parent" && (command.expectedClaimantId === null || (typeof command.expectedClaimantId === "string" && MEMBER_ID_PATTERN.test(command.expectedClaimantId))));
}
export function createRewardRetryIntent(rewardId: string, kind: RewardRetryIntent["kind"], issuedAt = Date.now(), owned?: OwnedRewardReview): RewardRetryIntent {
  if (typeof rewardId !== "string" || !MEMBER_ID_PATTERN.test(rewardId) || !["claim", "approve"].includes(kind) || !validTime(issuedAt))
    throw new Error("Reward request unavailable");
  let command: RewardActionCommand | undefined;
  if (owned) {
    const { userId, familyId, role, generation } = owned.owner;
    const common = { protocol: REWARD_ACTION_PROTOCOL, rewardId, issuedAt, sourceGeneration: owned.sourceGeneration,
      owner: Object.freeze({ userId, familyId, role, generation }) };
    command = kind === "claim" ? { ...common, kind, expectedCost: owned.expectedCost! }
      : { ...common, kind, expectedClaimantId: owned.expectedClaimantId! };
    if (!validCommand(command)) throw new Error("Reward request unavailable");
    Object.freeze(command);
  }
  return Object.freeze({ kind, rewardId, key: newIdempotencyKey(), issuedAt,
    body: JSON.stringify(command ?? { rewardId }), ...(command ? { command } : {}) });
}
export function rewardRetryWithinWindow(intent: RewardRetryIntent, now = Date.now()): boolean {
  const command = intent.command;
  const payloadMatches = command ? validCommand(command) && command.kind === intent.kind && command.rewardId === intent.rewardId
    && command.issuedAt === intent.issuedAt && intent.body === JSON.stringify(command)
    : intent.body === JSON.stringify({ rewardId: intent.rewardId });
  return ["claim", "approve"].includes(intent.kind) && typeof intent.rewardId === "string" && MEMBER_ID_PATTERN.test(intent.rewardId)
    && isValidIdempotencyKey(intent.key) && payloadMatches
    && validTime(intent.issuedAt) && validTime(now) && now >= intent.issuedAt && now - intent.issuedAt < IDEMPOTENCY_TTL_MS;
}
export function sameRewardRetryIntent(left: RewardRetryIntent, right: RewardRetryIntent): boolean {
  return left.kind === right.kind && left.rewardId === right.rewardId && left.key === right.key
    && left.body === right.body && left.issuedAt === right.issuedAt;
}
