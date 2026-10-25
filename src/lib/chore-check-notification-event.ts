/** Accepted account-chore check producer adapter, not yet wired into verify.
 * Caller owns the canonical check/XP/activity transaction and already holds
 * ordered actor/assignee User + household/actual row locks before chore writes.
 * Activity identity comes only from the fresh successful transition, never a
 * caller-supplied timestamp, unchanged edit epoch, old title or current status.
 */
import type { Prisma } from "@prisma/client";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { eligibleChoreAssigneeInTx } from "@/lib/chore-member-subject";
import { admitNotificationEventInTx, type NotificationEventActor } from "@/lib/notification-event-admission";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { choreNotificationDestination } from "@/lib/notification-destination";
import { readPrivateNotificationDispatchWindow } from "@/lib/notification-event-policy";

export function choreCheckNotificationDispatchWindow() {
  return readPrivateNotificationDispatchWindow("CHORE_CHECK_NOTIFICATION_EVENTS_ENABLED", "CHORE_CHECK_NOTIFICATION_DISPATCH_MS");
}
type Check = {
  choreId: string; generation: string; recipientId: string; title: string;
  decision: "approve" | "reject"; notes: string | null;
  activityId: string; activityAt: Date; deliverBefore: Date;
  // Only the actual same-transaction awardChoreXP result may supply this value.
  // No points or credit ownership is changed or inferred by notifications.
  levelUpNewLevel?: number | null;
};
export async function deliverChoreCheckNotificationEventInTx(
  tx: Prisma.TransactionClient, actor: NotificationEventActor, check: Check,
  clock: () => Date = () => new Date(),
) {
  if (actor.role !== "parent" || !Number.isFinite(check.activityAt.getTime()) || !Number.isFinite(check.deliverBefore.getTime()))
    throw new Error("Chore check notification held");
  if (check.levelUpNewLevel != null && (!Number.isSafeInteger(check.levelUpNewLevel) || check.levelUpNewLevel < 1))
    throw new Error("Chore check level evidence held");
  const activityType = check.decision === "approve" ? "chore_verified" : "chore_rejected";
  const status = check.decision === "approve" ? "verified" : "pending";
  const envelope = {
    protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: actor.familyId,
    kind: check.decision === "approve" ? "chore.verification" as const : "chore.returned" as const,
    sourceId: check.choreId, sourceGeneration: check.generation,
    transitionId: check.activityId, occurredAt: check.activityAt.toISOString(),
    deliverBefore: check.deliverBefore.toISOString(),
  };
  let gamification = false;
  const sourceGuard = async (sourceTx: Prisma.TransactionClient) => {
    const families = await sourceTx.$queryRaw<Array<{ features: unknown }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "chores")) return false;
    gamification = isFeatureEnabled(normalizeFeatures(families[0].features), "gamification");
    const rows = await sourceTx.$queryRaw<Array<{ assigned_to: string | null; assigned_member_id: string | null; member_subject_erased: boolean; responsibility_generation: string; title: string; status: string; verified_notes: string | null }>>`
      SELECT "assigned_to", "assigned_member_id", "member_subject_erased", "responsibility_generation", "title", "status", "verified_notes"
      FROM "Chore" WHERE "id" = ${check.choreId} AND "family_id" = ${actor.familyId} FOR UPDATE`;
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.assigned_to !== check.recipientId || row.member_subject_erased
        || row.responsibility_generation !== check.generation || row.title !== check.title
        || row.status !== status || row.verified_notes !== check.notes) return false;
    const subject = await eligibleChoreAssigneeInTx(sourceTx, actor.familyId, check.recipientId, { requireCanonical: Boolean(row.assigned_member_id) });
    if (!subject || (row.assigned_member_id && subject.assigned_member_id !== row.assigned_member_id)) return false;
    const facts = await sourceTx.$queryRaw<Array<{ user_id: string; type: string; metadata: string | null; created_at: Date }>>`
      SELECT "user_id", "type", "metadata", "created_at" FROM "Activity"
      WHERE "id" = ${check.activityId} AND "family_id" = ${actor.familyId} FOR SHARE`;
    const fact = facts.length === 1 ? facts[0] : null;
    if (!fact || fact.user_id !== actor.userId || fact.type !== activityType || fact.created_at.getTime() !== check.activityAt.getTime()) return false;
    try {
      if (!fact.metadata || fact.metadata.length > 512 || JSON.parse(fact.metadata)?.choreId !== check.choreId) return false;
    } catch { return false; }
    if (check.decision === "approve" && gamification && check.levelUpNewLevel != null) {
      const person = await sourceTx.user.findUnique({ where: { id: check.recipientId }, select: { level: true } });
      if (person?.level !== check.levelUpNewLevel) return false;
    }
    return true;
  };
  const event = await admitNotificationEventInTx(tx, actor, envelope, sourceGuard, clock);
  if (event.kind === "held") throw new Error("Chore check event admission held");
  const actionUrl = choreNotificationDestination(check.choreId);
  if (!actionUrl) throw new Error("Chore check destination held");
  const message = check.decision === "approve"
    ? `Your chore "${check.title}" has been verified. Great job!${gamification && check.levelUpNewLevel != null ? ` You reached Level ${check.levelUpNewLevel}!` : ""}`
    : check.notes ? `"${check.title}": ${check.notes}` : `"${check.title}" needs another go.`;
  const outcome = await admitNotificationRecipientInTx(tx, actor, {
    eventId: event.id, slot: 0, userId: check.recipientId,
    content: { title: check.decision === "approve" ? "Chore Verified!" : "Have another go", message,
      type: check.decision === "approve" ? "reward" : "chore", actionUrl },
  }, async (sourceTx, stored) => compareNotificationOccurrence(envelope, stored) === "same" && await sourceGuard(sourceTx), clock);
  if (outcome.kind === "held") throw new Error("Chore check recipient admission held");
  return outcome;
}
