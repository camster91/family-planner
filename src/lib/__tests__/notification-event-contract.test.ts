// Authored UNRUN: proposed pure contract; no dispatcher, storage or provider.
import {
  NOTIFICATION_EVENT_PROTOCOL, NOTIFICATION_EVENT_IN_APP_TYPE, notificationEventEnvelope,
  notificationOccurrenceIdentity, notificationInAppDeliveryIdentity,
  compareNotificationOccurrence, notificationDispatchWindowOpen,
} from "../notification-event-contract";
const event = {
  protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: "fixture-family",
  kind: "chore.verification" as const, sourceId: "fixture-chore",
  sourceGeneration: "9bd8c8d1-f311-4d4c-8b5c-36cd7fd99436",
  transitionId: "fixture-transition", occurredAt: "2026-10-25T12:00:00.000Z",
  deliverBefore: "2026-10-25T13:00:00.000Z",
};
it("keeps recipient/channel identities separate from the canonical occurrence", () => {
  expect(notificationInAppDeliveryIdentity(event, "fixture-parent")).not.toBe(notificationInAppDeliveryIdentity(event, "fixture-teen"));
  for (const change of [{ familyId: "other-family" }, { kind: "chore.returned" as const }, { sourceId: "other-chore" }, { transitionId: "next-real-completion" }, { sourceGeneration: "389fa6f7-b3e9-4495-a6ef-1aca256d654c" }])
    expect(notificationOccurrenceIdentity({ ...event, ...change })).not.toBe(notificationOccurrenceIdentity(event));
});
it("does not renew an original occurrence merely by changing its dispatch deadline", () => {
  const changed = { ...event, deliverBefore: "2026-10-25T14:00:00.000Z" };
  expect(notificationOccurrenceIdentity(changed)).toBe(notificationOccurrenceIdentity(event));
  expect(compareNotificationOccurrence(changed, event)).toBe("conflict");
  expect(compareNotificationOccurrence({ ...event }, event)).toBe("same");
  expect(compareNotificationOccurrence({ ...event, transitionId: "later-transition" }, event)).toBe("different-occurrence");
});
it("holds unknown persisted versions and rejects names/text/actor proof fields", () => {
  expect(compareNotificationOccurrence(event, { ...event, protocol: "future.v2" })).toBe("unsupported");
  expect(compareNotificationOccurrence(event, null)).toBe("unsupported");
  for (const input of [{ ...event, title: "Private title" }, { ...event, actorRole: "parent" }, { ...event, sourceGeneration: event.sourceId }, { ...event, occurredAt: "2026-10-25T12:00:00Z" }])
    expect(notificationEventEnvelope.safeParse(input).success).toBe(false);
});
it("holds future/expired/invalid clocks with an exclusive dispatch deadline", () => {
  expect(notificationDispatchWindowOpen(event, new Date(event.occurredAt))).toBe(true);
  expect(notificationDispatchWindowOpen(event, new Date("2026-10-25T12:59:59.999Z"))).toBe(true);
  for (const now of [new Date("2026-10-25T11:59:59.999Z"), new Date(event.deliverBefore), new Date(NaN)])
    expect(notificationDispatchWindowOpen(event, now)).toBe(false);
  expect(notificationEventEnvelope.safeParse({ ...event, deliverBefore: event.occurredAt }).success).toBe(false);
});


it("preserves existing notification category semantics for accepted chore checks", () => {
  expect(NOTIFICATION_EVENT_IN_APP_TYPE["chore.verification"]).toBe("reward");
  expect(NOTIFICATION_EVENT_IN_APP_TYPE["chore.returned"]).toBe("chore");
  expect(NOTIFICATION_EVENT_IN_APP_TYPE["chore.assignment"]).toBe("chore");
});

it("adds the actual reward birth kind without admitting arbitrary future events", () => {
  expect(notificationEventEnvelope.safeParse({ ...event, kind: "reward.created", sourceId: "fixture-reward", transitionId: "created" }).success).toBe(true);
  expect(NOTIFICATION_EVENT_IN_APP_TYPE["reward.created"]).toBe("reward");
  expect(notificationEventEnvelope.safeParse({ ...event, kind: "reward.dynamic-future" }).success).toBe(false);
});
