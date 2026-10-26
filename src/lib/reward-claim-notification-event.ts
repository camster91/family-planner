/** Default-off canonical reward-claim adapter. Same transaction as claim/XP/
 * receipt. Bounded frozen parent roster, never a reconstructed retry fanout.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockRewardNotificationParticipants } from "@/lib/reward-notification-owner";
import { readPrivateNotificationDispatchWindow } from "@/lib/notification-event-policy";
import { admitNotificationEventInTx, type NotificationEventActor } from "@/lib/notification-event-admission";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { rewardNotificationDestination } from "@/lib/notification-destination";
export type RewardClaimNotificationPlan = { recipients: string[]; windowMs: number; actor: NotificationEventActor };
const held = () => new Error("Reward claim notification held");
export async function prepareRewardClaimNotifications(
  db: Pick<PrismaClient, "$transaction">,
  actor: { userId: string; familyId: string; role: string; tokenVersion?: number },
): Promise<RewardClaimNotificationPlan | null> {
  const windowMs = readPrivateNotificationDispatchWindow("REWARD_CLAIM_NOTIFICATION_EVENTS_ENABLED", "REWARD_CLAIM_NOTIFICATION_DISPATCH_MS");
  if (windowMs === null) return null;
  const generation = actor.tokenVersion;
  if (!Number.isSafeInteger(generation) || generation! < 0 || !["parent", "teen", "child"].includes(actor.role)) throw held();
  const original: NotificationEventActor = { ...actor, tokenVersion: generation! };
  const recipients = await db.$transaction(async tx => {
    const person = await tx.user.findFirst({ where: { id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: generation } , select: { id: true } });
    if (!person) throw held();
    const rows = await tx.user.findMany({ where: { family_id: actor.familyId, role: "parent" }, select: { id: true }, orderBy: { id: "asc" }, take: 101 });
    if (rows.length > 100) throw held();
    return rows.map(row => row.id);
  }, { timeout: 5000, maxWait: 5000 });
  return { actor: original, recipients, windowMs };
}
/** Acquire every candidate User before household, source and receipt rows.
 * Compare the complete roster after locking; new/removed parents cause a hold,
 * never a partial/truncated delivery or late acquisition of a new User lock.
 */
export async function lockRewardClaimNotificationPlan(tx: Prisma.TransactionClient, plan: RewardClaimNotificationPlan) {
  const people = await lockRewardNotificationParticipants(tx, plan.actor, plan.recipients);
  const parents = await tx.user.findMany({ where: { family_id: plan.actor.familyId, role: "parent" }, select: { id: true }, orderBy: { id: "asc" }, take: 101 });
  if (parents.length > 100 || JSON.stringify(parents.map(row => row.id)) !== JSON.stringify(plan.recipients)
      || plan.recipients.some(id => !people.some(row => row.id === id && row.family_id === plan.actor.familyId && row.role === "parent"))) throw held();
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
  const recipients: Array<string | null> = plan.recipients.length ? plan.recipients : [null];
  for (const [slot, userId] of recipients.entries()) {
    const result = await admitNotificationRecipientInTx(tx, plan.actor, { eventId: event.id, slot, userId,
      content: { title: "Reward claimed", message: `A family member claimed "${row.name}" for ${input.cost} points.`, type: "reward", actionUrl } },
      async (sourceTx, persisted) => compareNotificationOccurrence(envelope, persisted) === "same" && await sourceGuard(sourceTx), clock);
    if (result.kind === "held") throw held();
  }
}
