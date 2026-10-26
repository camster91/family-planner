/** Default-off accepted approval adapter. No second approval/XP/receipt engine. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockRewardNotificationParticipants } from "@/lib/reward-notification-owner";
import { readPrivateNotificationDispatchWindow } from "@/lib/notification-event-policy";
import { admitNotificationEventInTx, type NotificationEventActor } from "@/lib/notification-event-admission";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { rewardNotificationDestination } from "@/lib/notification-destination";
export type RewardApprovalNotificationPlan = { actor: NotificationEventActor; claimantId: string | null; windowMs: number };
const held = () => new Error("Reward approval notification held");
export async function prepareRewardApprovalNotifications(
  db: Pick<PrismaClient, "$transaction">,
  original: { userId: string; familyId: string; role: string; tokenVersion?: number },
  rewardId: string,
): Promise<RewardApprovalNotificationPlan | null> {
  const windowMs = readPrivateNotificationDispatchWindow("REWARD_APPROVAL_NOTIFICATION_EVENTS_ENABLED", "REWARD_APPROVAL_NOTIFICATION_DISPATCH_MS");
  if (windowMs === null) return null;
  const generation = original.tokenVersion;
  if (original.role !== "parent" || !Number.isSafeInteger(generation) || generation! < 0) throw held();
  const claimantId = await db.$transaction(async tx => {
    const parent = await tx.user.findFirst({ where: { id: original.userId, family_id: original.familyId, role: "parent", token_version: generation }, select: { id: true } });
    if (!parent) throw held();
    const row = await tx.reward.findFirst({ where: { id: rewardId, family_id: original.familyId }, select: { claimed_by: true } });
    return row?.claimed_by ?? null;
  }, { timeout: 5000, maxWait: 5000 });
  return { actor: { ...original, tokenVersion: generation! }, claimantId, windowMs };
}
export async function lockRewardApprovalNotificationPlan(tx: Prisma.TransactionClient, plan: RewardApprovalNotificationPlan) {
  if (plan.actor.role !== "parent") throw held();
  const people = await lockRewardNotificationParticipants(tx, plan.actor, plan.claimantId ? [plan.claimantId] : []);
  const claimant = people.find(row => row.id === plan.claimantId);
  // No content is sent to a departed/deleted claimant or a replacement account.
  return claimant?.family_id === plan.actor.familyId && ["parent", "teen", "child"].includes(claimant.role) ? claimant.id : null;
}
export async function recordRewardApprovalNotificationInTx(
  tx: Prisma.TransactionClient, plan: RewardApprovalNotificationPlan,
  input: { rewardId: string; transitionId: string; approvedAt: Date; recipientId: string | null },
  clock: () => Date = () => new Date(),
) {
  const rows = await tx.$queryRaw<Array<{ notification_generation: string; notification_approval_id: string | null; claimed_by: string | null; approved_by: string | null; approved_at: Date | null; approved: boolean; status: string; name: string }>>`
    SELECT "notification_generation", "notification_approval_id", "claimed_by", "approved_by", "approved_at", "approved", "status", "name"
    FROM "Reward" WHERE "id" = ${input.rewardId} AND "family_id" = ${plan.actor.familyId} FOR UPDATE`;
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.notification_approval_id !== input.transitionId || row.claimed_by !== plan.claimantId || !row.approved
      || row.approved_by !== plan.actor.userId || row.approved_at?.getTime() !== input.approvedAt.getTime() || row.status !== "redeemed"
      || (input.recipientId !== null && input.recipientId !== plan.claimantId)) throw held();
  const envelope = { protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: plan.actor.familyId, kind: "reward.approval" as const,
    sourceId: input.rewardId, sourceGeneration: row.notification_generation, transitionId: input.transitionId,
    occurredAt: input.approvedAt.toISOString(), deliverBefore: new Date(input.approvedAt.getTime() + plan.windowMs).toISOString() };
  const sourceGuard = async (sourceTx: Prisma.TransactionClient) => {
    const current = await sourceTx.$queryRaw<Array<typeof row>>`
      SELECT "notification_generation", "notification_approval_id", "claimed_by", "approved_by", "approved_at", "approved", "status", "name"
      FROM "Reward" WHERE "id" = ${input.rewardId} AND "family_id" = ${plan.actor.familyId} FOR UPDATE`;
    const value = current.length === 1 ? current[0] : null;
    return Boolean(value && value.notification_generation === row.notification_generation && value.notification_approval_id === input.transitionId
      && value.claimed_by === plan.claimantId && value.approved_by === plan.actor.userId && value.approved
      && value.approved_at?.getTime() === input.approvedAt.getTime() && value.name === row.name && value.status === "redeemed");
  };
  const event = await admitNotificationEventInTx(tx, plan.actor, envelope, sourceGuard, clock);
  if (event.kind === "held") throw held();
  const actionUrl = rewardNotificationDestination(input.rewardId);
  if (!actionUrl) throw held();
  const result = await admitNotificationRecipientInTx(tx, plan.actor, { eventId: event.id, slot: 0, userId: input.recipientId,
    content: { title: "Reward Approved!", message: `Your parent approved "${row.name}". Enjoy your reward!`, type: "reward", actionUrl } },
    async (sourceTx, persisted) => compareNotificationOccurrence(envelope, persisted) === "same" && await sourceGuard(sourceTx), clock);
  if (result.kind === "held") throw held();
}
