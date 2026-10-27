/** Fresh canonical Reward birth only; atomic with create and existing receipt. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareRewardNotificationRoster, lockRewardNotificationRoster, type RewardNotificationRoster } from "@/lib/reward-notification-roster";
import { admitNotificationEventInTx } from "@/lib/notification-event-admission";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { rewardNotificationDestination } from "@/lib/notification-destination";
export function prepareRewardCreationNotifications(db: Pick<PrismaClient, "$transaction">,
  actor: { userId: string; familyId: string; role: string; tokenVersion?: number }) {
  return prepareRewardNotificationRoster(db, actor, "others", "REWARD_CREATE_NOTIFICATION_EVENTS_ENABLED", "REWARD_CREATE_NOTIFICATION_DISPATCH_MS");
}
export const lockRewardCreationNotificationPlan = (tx: Prisma.TransactionClient, plan: RewardNotificationRoster) => lockRewardNotificationRoster(tx, plan, "others");
type Birth = { id: string; family_id: string; created_by: string; notification_generation: string; created_at: Date; name: string; cost: number };
export async function recordRewardCreationNotificationsInTx(tx: Prisma.TransactionClient, plan: RewardNotificationRoster, birth: Birth, clock: () => Date = () => new Date()) {
  const held = () => new Error("Reward birth notification held");
  if (plan.actor.role !== "parent" || birth.family_id !== plan.actor.familyId || birth.created_by !== plan.actor.userId
      || !Number.isSafeInteger(birth.cost) || birth.cost < 1 || !Number.isFinite(birth.created_at.getTime())) throw held();
  const envelope = { protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: plan.actor.familyId, kind: "reward.created" as const,
    sourceId: birth.id, sourceGeneration: birth.notification_generation, transitionId: "created",
    occurredAt: birth.created_at.toISOString(), deliverBefore: new Date(birth.created_at.getTime() + plan.windowMs).toISOString() };
  const sourceGuard = async (sourceTx: Prisma.TransactionClient) => {
    const rows = await sourceTx.$queryRaw<Array<Birth & { status: string; is_active: boolean }>>`
      SELECT "id", "family_id", "created_by", "notification_generation", "created_at", "name", "cost", "status", "is_active"
      FROM "Reward" WHERE "id" = ${birth.id} AND "family_id" = ${plan.actor.familyId} FOR UPDATE`;
    const row = rows.length === 1 ? rows[0] : null;
    return Boolean(row && row.created_by === plan.actor.userId && row.notification_generation === birth.notification_generation
      && row.created_at.getTime() === birth.created_at.getTime() && row.name === birth.name && row.cost === birth.cost
      && row.status === "available" && row.is_active);
  };
  const event = await admitNotificationEventInTx(tx, plan.actor, envelope, sourceGuard, clock);
  if (event.kind === "held") throw held();
  const actionUrl = rewardNotificationDestination(birth.id);
  if (!actionUrl) throw held();
  const recipients: readonly (string | null)[] = plan.recipients.length ? plan.recipients : [null];
  for (const [slot, userId] of recipients.entries()) {
    const result = await admitNotificationRecipientInTx(tx, plan.actor, { eventId: event.id, slot, userId,
      content: { title: "New Reward Available!", message: `${birth.name} is now available for ${birth.cost} points`, type: "reward", actionUrl } },
      async (sourceTx, stored) => compareNotificationOccurrence(envelope, stored) === "same" && await sourceGuard(sourceTx), clock);
    if (result.kind === "held") throw held();
  }
}
