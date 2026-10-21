/** Fabricated source fixtures, never application data or runtime substitutes. */
import type { PreparationContext, PreparationCommand } from "../contract";
import { EVENT_PREPARATION_PROTOCOL } from "../contract";
export const actor = {
  userId: "parent-a",
  familyId: "family-a",
  tokenVersion: 2,
};
export const now = new Date("2026-10-20T12:00:00Z");
export function preparationTestFixture() {
  const context: PreparationContext = {
    actor: {
      kind: "person",
      userId: actor.userId,
      familyId: actor.familyId,
      role: "parent",
      memberProtocol: 2,
    },
    event: {
      id: "event-a",
      familyId: actor.familyId,
      sourceToken: "a".repeat(64),
      start: "2026-10-21T14:00:00Z",
      end: "2026-10-21T15:00:00Z",
      active: true,
    },
    timeZone: "America/Toronto",
    viewToken: "b".repeat(64),
    writesEnabled: true,
    pointsEnabled: false,
    profileWritesEnabled: true,
    complete: true,
    current: null,
    eligibleSubjects: [{ kind: "account", accountId: actor.userId }],
    tasks: [],
    routine: null,
  };
  const command: Extract<PreparationCommand, { action: "set-plan" }> = {
    protocol: EVENT_PREPARATION_PROTOCOL,
    owner: { userId: actor.userId, familyId: actor.familyId },
    memberProtocol: 2,
    eventId: context.event.id,
    eventSourceToken: context.event.sourceToken,
    expectedToken: context.viewToken,
    timeZone: context.timeZone,
    issuedAt: now.toISOString(),
    eventChangeDecision: null,
    action: "set-plan",
    steps: [
      {
        kind: "new",
        clientId: "new-step-a",
        title: "Pack lunch",
        description: null,
        subject: { kind: "account", accountId: actor.userId },
        points: null,
        difficulty: "easy",
        icon: null,
        durationMinutes: 5,
        dueDay: "2026-10-21",
        cue: null,
      },
    ],
  };
  return { context, command };
}
