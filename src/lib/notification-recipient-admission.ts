/** N2 terminal in-app slot; used by the default-off chore-create cohort.
 * Caller owns the canonical effect/admission/receipt transaction. A slot is a
 * frozen accepted recipient position, never recalculated from a new roster.
 */
import { notificationDestination } from "@/lib/notification-destination";
import type { Prisma } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { deliverNotificationInTx, type NotificationInput } from "@/lib/notification-delivery";
import { notificationEventAdmissionEnabled, type NotificationEventActor } from "@/lib/notification-event-admission";
import { notificationEventEnvelope, NOTIFICATION_EVENT_IN_APP_TYPE, compareNotificationOccurrence, notificationDispatchWindowOpen, type NotificationEventEnvelope } from "@/lib/notification-event-contract";

type Outcome = { kind: "held" } | { kind: "created" | "suppressed" | "existing"; notificationId: string | null };
export async function admitNotificationRecipientInTx(
  tx: Prisma.TransactionClient,
  actor: NotificationEventActor,
  input: { eventId: string; slot: number; userId: string | null; content: Pick<NotificationInput, "title" | "message" | "type" | "actionUrl"> },
  // Must lock/recheck canonical original recipient/source, feature and allowed
  // content/type, not trust input.content or a cached notification projection.
  sourceGuard: (tx: Prisma.TransactionClient, event: NotificationEventEnvelope) => Promise<boolean>,
  clock: () => Date = () => new Date(),
): Promise<Outcome> {
  if (!notificationEventAdmissionEnabled() || !["parent", "teen", "child"].includes(actor.role)
      || !Number.isInteger(input.slot) || input.slot < 0 || input.slot >= 100
      || typeof input.content.title !== "string" || !input.content.title.trim() || input.content.title.length > 200
      || typeof input.content.message !== "string" || !input.content.message.trim() || input.content.message.length > 1000
      || (input.content.actionUrl != null && notificationDestination(input.content.actionUrl) === null)) return { kind: "held" };
  const ids = [...new Set([actor.userId, ...(input.userId ? [input.userId] : [])])].sort();
  for (const id of ids) await lockUser(tx, id);
  await lockHousehold(tx, actor.familyId);
  const users = await tx.$queryRaw<Array<{ id: string; family_id: string | null; role: string; token_version: number }>>`
    SELECT "id", "family_id", "role", "token_version" FROM "User"
    WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR SHARE`;
  const sender = users.find(row => row.id === actor.userId);
  const recipient = users.find(row => row.id === input.userId);
  if (sender?.family_id !== actor.familyId || sender.role !== actor.role || sender.token_version !== actor.tokenVersion
      || (input.userId !== null && recipient?.family_id !== actor.familyId)) return { kind: "held" };
  const current = await tx.notificationEventOccurrence.findFirst({
    where: { id: input.eventId, family_id: actor.familyId }, select: { envelope: true },
  });
  const parsed = notificationEventEnvelope.safeParse(current?.envelope);
  if (!parsed.success || parsed.data.familyId !== actor.familyId || !notificationDispatchWindowOpen(parsed.data, clock())) return { kind: "held" };
  // The only nonparent producer is an accepted own reward claim to a parent.
  // Source guard below must prove the canonical actor/claim, not just the kind.
  if ((parsed.data.kind === "reward.claim" && input.userId !== null && recipient?.role !== "parent")
      || (actor.role !== "parent" && parsed.data.kind !== "reward.claim")) return { kind: "held" };
  // Explicit empty accepted reward roster is terminal; never invent a User or
  // infer that an absent decision is safe to populate from a later roster.
  if (input.userId === null && !["reward.claim", "reward.approval"].includes(parsed.data.kind)) return { kind: "held" };
  const expectedType = NOTIFICATION_EVENT_IN_APP_TYPE[parsed.data.kind];
  if (input.content.type !== expectedType || !await sourceGuard(tx, parsed.data)) return { kind: "held" };
  // Canonical source locks precede the event lock, matching producer admission.
  const locked = await tx.$queryRaw<Array<{ envelope: unknown }>>`
    SELECT "envelope" FROM "NotificationEventOccurrence"
    WHERE "id" = ${input.eventId} AND "family_id" = ${actor.familyId} FOR UPDATE`;
  if (locked.length !== 1 || compareNotificationOccurrence(parsed.data, locked[0].envelope) !== "same"
      || !notificationDispatchWindowOpen(parsed.data, clock())) return { kind: "held" };
  const prior = await tx.notificationRecipientDecision.findUnique({
    where: { event_id_slot: { event_id: input.eventId, slot: input.slot } },
    select: { family_id: true, user_id: true, status: true, notification_id: true },
  });
  if (prior) {
    // Erased/mismatched slots are terminal holds, never new recipient adoption.
    if (prior.family_id !== actor.familyId || prior.user_id !== input.userId
        || !["created", "suppressed"].includes(prior.status)) return { kind: "held" };
    return { kind: "existing", notificationId: prior.notification_id };
  }
  if (input.userId === null) {
    await tx.notificationRecipientDecision.create({ data: {
      family_id: actor.familyId, event_id: input.eventId, slot: input.slot,
      user_id: null, status: "suppressed", notification_id: null, quiet: true,
    } });
    if (!notificationDispatchWindowOpen(parsed.data, clock())) throw new Error("Notification recipient admission held");
    return { kind: "suppressed", notificationId: null };
  }
  const delivered = await deliverNotificationInTx(tx, {
    ...input.content, userId: input.userId, familyId: actor.familyId, senderId: actor.userId,
  }, clock());
  await tx.notificationRecipientDecision.create({ data: {
    family_id: actor.familyId, event_id: input.eventId, slot: input.slot, user_id: input.userId,
    status: delivered.delivered ? "created" : "suppressed",
    notification_id: delivered.delivered ? delivered.notification.id : null,
    quiet: delivered.delivered ? delivered.quiet : true,
  } });
  // If a wait crossed the deadline, force rollback of both row and decision.
  if (!notificationDispatchWindowOpen(parsed.data, clock())) throw new Error("Notification recipient admission held");
  return { kind: delivered.delivered ? "created" : "suppressed", notificationId: delivered.delivered ? delivered.notification.id : null };
}
