/** Closed native producer for an actual parent check transition. The caller
 * witnesses the actor, original chore, canonical assignee and selected recipient
 * policy, then commits this plan with the chore/XP/activity effects. */
import { createHash, randomUUID } from "node:crypto";
import {
  NOTIFICATION_EVENT_PROTOCOL,
  notificationEventEnvelope,
  notificationOccurrenceIdentity,
} from "@/lib/notification-event-contract";
import { choreNotificationDestination } from "@/lib/notification-destination";
import { notificationDeliveryDecision } from "@/lib/notification-delivery-policy";
import { prepareD1NotificationRow } from "./notification-delivery";
import { d1WriteCheck } from "./write-check";
import type { D1Store } from "./database";
export function prepareD1ChoreCheckNotification(
  session: Pick<D1Store, "prepare">,
  input: {
    familyId: string;
    actorId: string;
    choreId: string;
    generation: string;
    title: string;
    recipientId: string;
    decision: "approve" | "reject";
    notes: string | null;
    activityId: string;
    now: Date;
    windowMs: number;
    gamification: boolean;
    levelUp: number | null;
    policy: ReturnType<typeof notificationDeliveryDecision>;
  },
) {
  const event = notificationEventEnvelope.parse({
    protocol: NOTIFICATION_EVENT_PROTOCOL,
    familyId: input.familyId,
    kind:
      input.decision === "approve" ? "chore.verification" : "chore.returned",
    sourceId: input.choreId,
    sourceGeneration: input.generation,
    transitionId: input.activityId,
    occurredAt: input.now.toISOString(),
    deliverBefore: new Date(input.now.getTime() + input.windowMs).toISOString(),
  });
  const actionUrl = choreNotificationDestination(input.choreId);
  if (!actionUrl) throw new Error("Chore check destination held");
  const message =
    input.decision === "approve"
      ? `Your chore "${input.title}" has been verified. Great job!${input.gamification && input.levelUp !== null ? ` You reached Level ${input.levelUp}!` : ""}`
      : input.notes
        ? `"${input.title}": ${input.notes}`
        : `"${input.title}" needs another go.`;
  const title =
    input.decision === "approve" ? "Chore Verified!" : "Have another go";
  if (
    !title.trim() ||
    title.length > 200 ||
    !message.trim() ||
    message.length > 1000
  )
    throw new Error("Chore check recipient admission held");
  const notice = prepareD1NotificationRow(
    session,
    {
      userId: input.recipientId,
      familyId: input.familyId,
      title,
      message,
      type: input.decision === "approve" ? "reward" : "chore",
      actionUrl,
    },
    input.policy,
    input.now,
  );
  const occurrenceId = randomUUID(),
    key = createHash("sha256")
      .update(notificationOccurrenceIdentity(event))
      .digest("hex");
  return [
    // Check actual post-effect rows as well as the caller's pre-effect witness.
    d1WriteCheck(
      session,
      `EXISTS(SELECT 1 FROM "Chore" WHERE id=?1 AND family_id=?2 AND assigned_to=?3 AND member_subject_erased=0 AND responsibility_generation=?4 AND title=?5 AND status=?6 AND verified_notes IS ?7)`,
      [
        input.choreId,
        input.familyId,
        input.recipientId,
        input.generation,
        input.title,
        input.decision === "approve" ? "verified" : "pending",
        input.notes,
      ],
    ),
    d1WriteCheck(
      session,
      `EXISTS(SELECT 1 FROM "Activity" WHERE id=?1 AND family_id=?2 AND user_id=?3 AND type=?4 AND created_at=?5 AND json_extract(metadata,'$.choreId')=?6)`,
      [
        input.activityId,
        input.familyId,
        input.actorId,
        input.decision === "approve" ? "chore_verified" : "chore_rejected",
        input.now.getTime(),
        input.choreId,
      ],
    ),
    ...(input.gamification && input.levelUp !== null
      ? [
          d1WriteCheck(
            session,
            `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND level=?3)`,
            [input.recipientId, input.familyId, input.levelUp],
          ),
        ]
      : []),
    session
      .prepare(
        `INSERT INTO "NotificationEventOccurrence"(id,family_id,occurrence_key,envelope,created_at) VALUES (?1,?2,?3,?4,?5)`,
      )
      .bind(
        occurrenceId,
        input.familyId,
        key,
        JSON.stringify(event),
        input.now.getTime(),
      ),
    ...notice.statements,
    session
      .prepare(
        `INSERT INTO "NotificationRecipientDecision"(id,family_id,event_id,slot,user_id,notification_id,status,quiet,created_at) VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8)`,
      )
      .bind(
        randomUUID(),
        input.familyId,
        occurrenceId,
        input.recipientId,
        notice.result.notification?.id ?? null,
        notice.result.delivered ? "created" : "suppressed",
        notice.result.delivered ? Number(notice.result.quiet) : 1,
        input.now.getTime(),
      ),
    // A batch waiting for the writer must not deliver after its deadline. A
    // false check rolls back the canonical check, XP, activity and both notices.
    d1WriteCheck(
      session,
      `?1 <= CAST(unixepoch('subsec')*1000 AS INTEGER) AND CAST(unixepoch('subsec')*1000 AS INTEGER) < ?2`,
      [input.now.getTime(), Date.parse(event.deliverBefore)],
    ),
  ];
}
