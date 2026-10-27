/** Default-off canonical reward-claim adapter. Same transaction as claim/XP/
 * receipt. Bounded frozen parent roster, never a reconstructed retry fanout.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareRewardNotificationRoster, lockRewardNotificationRoster, type RewardNotificationRoster } from "@/lib/reward-notification-roster";
import { admitNotificationEventInTx } from "@/lib/notification-event-admission";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { rewardNotificationDestination } from "@/lib/notification-destination";
export type RewardClaimNotificationPlan = RewardNotificationRoster;
const held = () => new Error("Reward claim notification held");
export async function prepareRewardClaimNotifications(
  db: Pick<PrismaClient, "$transaction">,
  actor: { userId: string; familyId: string; role: string; tokenVersion?: number },
): Promise<RewardClaimNotificationPlan | null> {
  return prepareRewardNotificationRoster(db, actor, "parents", "REWARD_CLAIM_NOTIFICATION_EVENTS_ENABLED", "REWARD_CLAIM_NOTIFICATION_DISPATCH_MS");
}
/** Acquire every candidate User before household, source and receipt rows.
 * Compare the complete roster after locking; new/removed parents cause a hold,
 * never a partial/truncated delivery or late acquisition of a new User lock.
 */
export async function lockRewardClaimNotificationPlan(tx: Prisma.TransactionClient, plan: RewardClaimNotificationPlan) {
  return lockRewardNotificationRoster(tx, plan, "parents");
}
export async function recordRewardClaimNotificationsInTx(
  tx: Prisma.TransactionClient, plan: RewardClaimNotificationPlan,
  input: { rewardId: string; transitionId: string; claimedAt: Date; cost: number },
  clock: () => Date = () => new Date(),
) {
  const rows = await tx.$queryRaw<Array<{ notification_generation: string; notification_claim_id: string | null; family_id: string; claimed_by: string | null; claimed_at: Date | null; cost: number; name: string; status: string }>>`
    SELECT "notification_generation", "notification_claim_id", "family_id", "claimed_by", "claimed_at", "cost", "name", "status"
    FROM "Reward" WHERE "id" = ${input.rewardId} AND "family_id" = ${plan.actor.familyId} FOR UPDATE`;
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.status !== "claimed" || row.claimed_by !== plan.actor.userId || row.notification_claim_id !== input.transitionId
      || row.claimed_at?.getTime() !== input.claimedAt.getTime() || row.cost !== input.cost) throw held();
  const envelope = { protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: plan.actor.familyId, kind: "reward.claim" as const,
    sourceId: input.rewardId, sourceGeneration: row.notification_generation, transitionId: input.transitionId,
    occurredAt: input.claimedAt.toISOString(), deliverBefore: new Date(input.claimedAt.getTime() + plan.windowMs).toISOString() };
  const sourceGuard = async (sourceTx: Prisma.TransactionClient) => {
    const current = await sourceTx.$queryRaw<Array<{ notification_generation: string; notification_claim_id: string | null; claimed_by: string | null; claimed_at: Date | null; cost: number; name: string; status: string }>>`
      SELECT "notification_generation", "notification_claim_id", "claimed_by", "claimed_at", "cost", "name", "status" FROM "Reward"
      WHERE "id" = ${input.rewardId} AND "family_id" = ${plan.actor.familyId} FOR UPDATE`;
    const value = current.length === 1 ? current[0] : null;
    return Boolean(value && value.notification_generation === row.notification_generation && value.notification_claim_id === input.transitionId
      && value.claimed_by === plan.actor.userId && value.claimed_at?.getTime() === input.claimedAt.getTime()
      && value.cost === input.cost && value.name === row.name && value.status === "claimed");
  };
  const event = await admitNotificationEventInTx(tx, plan.actor, envelope, sourceGuard, clock);
  if (event.kind === "held") throw held();
  const actionUrl = rewardNotificationDestination(input.rewardId);
  if (!actionUrl) throw held();
  const recipients: readonly (string | null)[] = plan.recipients.length ? plan.recipients : [null];
  for (const [slot, userId] of recipients.entries()) {
    const result = await admitNotificationRecipientInTx(tx, plan.actor, { eventId: event.id, slot, userId,
      content: { title: "Reward claimed", message: `A family member claimed "${row.name}" for ${input.cost} points.`, type: "reward", actionUrl } },
      async (sourceTx, persisted) => compareNotificationOccurrence(envelope, persisted) === "same" && await sourceGuard(sourceTx), clock);
    if (result.kind === "held") throw held();
  }
}
