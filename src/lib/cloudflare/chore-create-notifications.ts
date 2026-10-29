/** Closed canonical birth producer. Caller witnesses creator/recipient/family
 * and commits the exact new row, occurrence, slot and inbox in the SAME batch. */
import { createHash, randomUUID } from "node:crypto";
import {
  notificationEventEnvelope,
  notificationOccurrenceIdentity,
  NOTIFICATION_EVENT_PROTOCOL,
} from "@/lib/notification-event-contract";
import { choreNotificationDestination } from "@/lib/notification-destination";
import { notificationDeliveryDecision } from "@/lib/notification-delivery-policy";
import { prepareD1NotificationRow } from "./notification-delivery";
import { d1WriteCheck } from "./write-check";
import type { D1Store } from "./database";
export function prepareD1ChoreCreateNotification(
  session: Pick<D1Store, "prepare">,
  input: {
    id: string;
    familyId: string;
    actorId: string;
    actorName: string;
    recipientId: string;
    generation: string;
    title: string;
    dueDate: Date;
    createdAt: Date;
    windowMs: number;
    policy: ReturnType<typeof notificationDeliveryDecision>;
  },
) {
  const event = notificationEventEnvelope.parse({
    protocol: NOTIFICATION_EVENT_PROTOCOL,
    familyId: input.familyId,
    kind: "chore.assignment",
    sourceId: input.id,
    sourceGeneration: input.generation,
    transitionId: "created",
    occurredAt: input.createdAt.toISOString(),
    deliverBefore: new Date(
      input.createdAt.getTime() + input.windowMs,
    ).toISOString(),
  });
  const actionUrl = choreNotificationDestination(input.id),
    message = `${input.actorName} assigned you "${input.title}" (due ${input.dueDate.toLocaleDateString()})`;
  if (!actionUrl || message.length > 1000)
    throw new Error("Chore creation notification held");
  const notice = prepareD1NotificationRow(
    session,
    {
      userId: input.recipientId,
      familyId: input.familyId,
      title: "New Chore Assigned",
      message,
      type: "chore",
      actionUrl,
    },
    input.policy,
    input.createdAt,
  );
  const eventId = randomUUID(),
    key = createHash("sha256")
      .update(notificationOccurrenceIdentity(event))
      .digest("hex");
  return [
    d1WriteCheck(
      session,
      `EXISTS(SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND created_by=?3 AND assigned_to=?4 AND responsibility_generation=?5 AND created_at=?6 AND title=?7 AND due_date=?8 AND status='pending' AND member_subject_erased=0)`,
      [
        input.id,
        input.familyId,
        input.actorId,
        input.recipientId,
        input.generation,
        input.createdAt.getTime(),
        input.title,
        input.dueDate.getTime(),
      ],
    ),
    session
      .prepare(
        `INSERT INTO "NotificationEventOccurrence"(id,family_id,occurrence_key,envelope,created_at) VALUES (?1,?2,?3,?4,?5)`,
      )
      .bind(
        eventId,
        input.familyId,
        key,
        JSON.stringify(event),
        input.createdAt.getTime(),
      ),
    ...notice.statements,
    session
      .prepare(
        `INSERT INTO "NotificationRecipientDecision"(id,family_id,event_id,slot,user_id,notification_id,status,quiet,created_at) VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8)`,
      )
      .bind(
        randomUUID(),
        input.familyId,
        eventId,
        input.recipientId,
        notice.result.notification?.id ?? null,
        notice.result.delivered ? "created" : "suppressed",
        notice.result.delivered ? Number(notice.result.quiet) : 1,
        input.createdAt.getTime(),
      ),
    d1WriteCheck(
      session,
      `?1<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND CAST(unixepoch('subsec')*1000 AS INTEGER)<?2`,
      [input.createdAt.getTime(), Date.parse(event.deliverBefore)],
    ),
  ];
}
