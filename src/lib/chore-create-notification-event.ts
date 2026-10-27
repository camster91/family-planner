import { choreNotificationDestination } from "@/lib/notification-destination";
/** N1/N2 canonical birth-event adapter for the default-off chore-create cohort.
 * Call only with the actual freshly created row inside createPersonChore's
 * existing transaction, after its ordered User/household locks. No retroactive
 * adoption, current-assignee reconstruction or legacy sender fallback here.
 */
import type { Prisma } from "@prisma/client";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  admitNotificationEventInTx, notificationEventAdmissionEnabled,
  type NotificationEventActor,
} from "@/lib/notification-event-admission";
import { NOTIFICATION_EVENT_PROTOCOL, compareNotificationOccurrence } from "@/lib/notification-event-contract";
import { admitNotificationRecipientInTx } from "@/lib/notification-recipient-admission";
import { readPrivateNotificationDispatchWindow } from "@/lib/notification-event-policy";

type CreatedChore = {
  id: string; family_id: string; created_by: string; assigned_to: string | null;
  responsibility_generation: string; created_at: Date;
};
export async function recordChoreCreationNotificationEventInTx(
  tx: Prisma.TransactionClient,
  actor: NotificationEventActor,
  created: CreatedChore,
  // Explicit reviewed original deadline; no inferred TTL or renewed retry time.
  deliverBefore: Date,
  clock: () => Date = () => new Date(),
) {
  if (!notificationEventAdmissionEnabled() || actor.role !== "parent"
      || created.family_id !== actor.familyId || created.created_by !== actor.userId
      || !created.assigned_to || !Number.isFinite(created.created_at.getTime())
      || !Number.isFinite(deliverBefore.getTime()))
    return { kind: "held" as const };
  return admitNotificationEventInTx(tx, actor, choreCreationEnvelope(actor, created, deliverBefore),
    choreCreationSourceGuard(actor, created), clock);
}
function choreCreationEnvelope(actor: NotificationEventActor, created: CreatedChore, deliverBefore: Date) {
  return {
    protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: actor.familyId,
    kind: "chore.assignment" as const, sourceId: created.id,
    sourceGeneration: created.responsibility_generation,
    transitionId: "created", occurredAt: created.created_at.toISOString(),
    deliverBefore: deliverBefore.toISOString(),
  };
}
function choreCreationSourceGuard(
  actor: NotificationEventActor, created: CreatedChore,
  presentation?: { title: string; dueDate: Date },
) {
  return async (sourceTx: Prisma.TransactionClient) => {
    const families = await sourceTx.$queryRaw<Array<{ features: Prisma.JsonValue | null }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "chores")) return false;
    const rows = await sourceTx.$queryRaw<Array<CreatedChore & { title: string; due_date: Date; status: string; member_subject_erased: boolean }>>`
      SELECT "id", "family_id", "created_by", "assigned_to", "responsibility_generation", "created_at", "title", "due_date", "status", "member_subject_erased"
      FROM "Chore" WHERE "id" = ${created.id} AND "family_id" = ${actor.familyId} FOR UPDATE`;
    const row = rows.length === 1 ? rows[0] : null;
    return !!row && row.created_by === actor.userId && row.assigned_to === created.assigned_to
      && row.responsibility_generation === created.responsibility_generation
      && row.created_at.getTime() === created.created_at.getTime()
      && (!presentation || (row.title === presentation.title && row.due_date.getTime() === presentation.dueDate.getTime()))
      && row.status === "pending" && !row.member_subject_erased;
  };
}

/** No default duration is invented. Both private acknowledgements and a reviewed
 * positive dispatch window (at most the existing receipt horizon) are required.
 * Misconfigured opted-in mode fails before creation rather than falling back.
 */
export function choreCreateNotificationDispatchWindow(): number | null {
  return readPrivateNotificationDispatchWindow("CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED", "CHORE_CREATE_NOTIFICATION_DISPATCH_MS");
}

export async function deliverChoreCreationNotificationEventInTx(
  tx: Prisma.TransactionClient, actor: NotificationEventActor,
  created: CreatedChore & { title: string; due_date: Date }, deliverBefore: Date,
  clock: () => Date = () => new Date(),
) {
  const event = await recordChoreCreationNotificationEventInTx(tx, actor, created, deliverBefore, clock);
  if (event.kind === "held" || !created.assigned_to) throw new Error("Chore notification event admission held");
  // N1 holds the actual creator row, so this canonical name cannot change
  // between the content read and the recipient decision in this transaction.
  const creator = await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  if (!creator) throw new Error("Chore notification creator unavailable");
  const actionUrl = choreNotificationDestination(created.id);
  if (!actionUrl) throw new Error("Chore notification destination unavailable");
  const expected = choreCreationEnvelope(actor, created, deliverBefore);
  const guard = choreCreationSourceGuard(actor, created, { title: created.title, dueDate: created.due_date });
  const outcome = await admitNotificationRecipientInTx(tx, actor, {
    eventId: event.id, slot: 0, userId: created.assigned_to,
    content: {
      title: "New Chore Assigned",
      actionUrl,
      message: `${creator.name} assigned you "${created.title}" (due ${created.due_date.toLocaleDateString()})`,
      type: "chore",
    },
  }, async (sourceTx, stored) => compareNotificationOccurrence(expected, stored) === "same" && await guard(sourceTx), clock);
  if (outcome.kind === "held") throw new Error("Chore notification recipient admission held");
  return outcome;
}

