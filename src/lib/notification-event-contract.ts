/** Proposed N1 internal contract (#141), currently unconnected.
 * Coordinates are not authority. Canonical domain transactions must create/reuse
 * transition identity; no timestamp/title/receipt-key inference is permitted.
 */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";

export const NOTIFICATION_EVENT_PROTOCOL = "herewoven.notification-event.v1" as const;
// Fixed UTC transport spelling avoids equivalent instants becoming new intents.
const instant = z.string().length(24).refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
export const notificationEventKind = z.enum([
  "chore.assignment", "chore.verification", "chore.returned",
  "reward.created", "reward.claim", "reward.approval", "household.announcement",
]);
/** Preserve the current central category: parent verification is a reward notice
 * (still controlled by chores preferences), while assignment/return are chores.
 */
export const NOTIFICATION_EVENT_IN_APP_TYPE = {
  "chore.assignment": "chore", "chore.verification": "reward", "chore.returned": "chore",
  "reward.created": "reward", "reward.claim": "reward", "reward.approval": "reward", "household.announcement": "system",
} as const satisfies Record<z.infer<typeof notificationEventKind>, import("@/lib/notification-policy").InAppNotificationType>;
export const notificationEventEnvelope = z.object({
  protocol: z.literal(NOTIFICATION_EVENT_PROTOCOL),
  familyId: id,
  kind: notificationEventKind,
  sourceId: id,
  // These must come from reviewed durable domain state. Existing rows are not
  // retroactively given a generation by treating their ID/name as one.
  sourceGeneration: z.string().uuid(),
  transitionId: id,
  occurredAt: instant,
  deliverBefore: instant,
}).strict().refine(value => Date.parse(value.occurredAt) < Date.parse(value.deliverBefore), {
  message: "Dispatch deadline must follow the accepted occurrence",
});
export type NotificationEventEnvelope = z.infer<typeof notificationEventEnvelope>;

/** Private storage coordinate only, never a navigation URL, log or permission.
 * Source kind and generation prevent unrelated domains/recreated sources from
 * sharing an identity. Deadlines/content do not manufacture a second occurrence.
 */
export function notificationOccurrenceIdentity(input: NotificationEventEnvelope): string {
  const event = notificationEventEnvelope.parse(input);
  return JSON.stringify([
    event.protocol, event.familyId, event.kind, event.sourceId,
    event.sourceGeneration, event.transitionId,
  ]);
}
export function notificationInAppDeliveryIdentity(input: NotificationEventEnvelope, recipientUserId: string): string {
  return JSON.stringify([notificationOccurrenceIdentity(input), id.parse(recipientUserId), "in_app"]);
}

/** An existing occurrence's reviewed fields are immutable. A reused coordinate
 * with a changed deadline/body is a conflict, never a new admission or overwrite.
 * Malformed/unknown-version persisted evidence must hold, not be treated absent.
 */
export function compareNotificationOccurrence(candidate: unknown, persisted: unknown):
  "same" | "different-occurrence" | "conflict" | "unsupported" {
  const proposed = notificationEventEnvelope.safeParse(candidate);
  const stored = notificationEventEnvelope.safeParse(persisted);
  if (!proposed.success || !stored.success) return "unsupported";
  if (notificationOccurrenceIdentity(proposed.data) !== notificationOccurrenceIdentity(stored.data))
    return "different-occurrence";
  return JSON.stringify(proposed.data) === JSON.stringify(stored.data) ? "same" : "conflict";
}

/** Pure age predicate only; caller must still validate approved retention and
 * deadline policy, authoritative clock, current household/recipient/role,
 * canonical accepted transition, feature/preferences and dedupe/receipt state.
 */
export function notificationDispatchWindowOpen(input: unknown, now: Date): boolean {
  const parsed = notificationEventEnvelope.safeParse(input);
  const time = now.getTime();
  return parsed.success && Number.isFinite(time)
    && Date.parse(parsed.data.occurredAt) <= time
    && time < Date.parse(parsed.data.deliverBefore);
}
