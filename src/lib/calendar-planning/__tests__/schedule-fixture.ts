/** Isolated source fixtures, never production household data. */
import {
  SCHEDULE_REVIEW_PROTOCOL,
  previewScheduleMove,
  type ScheduleReviewSnapshot,
  type ScheduleReviewQuery,
} from "../conflict-review";
import {
  SCHEDULE_RECOVERY,
  type ScheduleRecoveryContext,
  type ScheduleRecoveryEntry,
} from "../schedule-recovery";
export const actor = {
  userId: "parent-a",
  familyId: "family-a",
  tokenVersion: 0,
};
export const now = new Date("2026-10-20T07:00:00Z"),
  key = "schedule_request_a";
export const snapshot: ScheduleReviewSnapshot = {
  protocol: SCHEDULE_REVIEW_PROTOCOL,
  owner: { userId: actor.userId, familyId: actor.familyId },
  role: "parent",
  timeZone: "America/Toronto",
  range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
  snapshotToken: "a".repeat(64),
  coverage: {
    complete: true,
    recurrence: "complete",
    capped: false,
    sourcesUnavailable: false,
  },
  events: [
    {
      id: "event-a",
      title: "Fixture event",
      start: "2026-10-20T10:00:00Z",
      end: "2026-10-20T11:00:00Z",
      sourceToken: "b".repeat(64),
      origin: "local",
      repeating: false,
      canMove: true,
    },
  ],
};
export const query: ScheduleReviewQuery = {
  protocol: SCHEDULE_REVIEW_PROTOCOL,
  owner: snapshot.owner,
  range: snapshot.range,
  timeZone: snapshot.timeZone,
  snapshotToken: snapshot.snapshotToken,
  target: { id: "event-a", sourceToken: "b".repeat(64) },
  buffers: { preparation: 0, travelBefore: 0, travelAfter: 0 },
  otherBuffers: [],
  windows: [{ start: "2026-10-20T08:00:00Z", end: "2026-10-20T16:00:00Z" }],
  gridMinutes: 15,
};
export const choice = {
  start: "2026-10-20T09:45:00.000Z",
  end: "2026-10-20T10:45:00.000Z",
};
export const command = previewScheduleMove(snapshot, query, choice, now);
export const entry: ScheduleRecoveryEntry = {
  kind: "schedule-move",
  key,
  body: JSON.stringify(command),
};
export const receipt = {
  receipt: {
    protocol: SCHEDULE_REVIEW_PROTOCOL,
    userId: actor.userId,
    familyId: actor.familyId,
    targetId: command.target.id,
    requestKey: key,
    action: "reschedule" as const,
    sourceToken: command.target.sourceToken,
    snapshotToken: command.snapshotToken,
    start: command.start,
    end: command.end,
  },
};
export const context: ScheduleRecoveryContext = {
  contract: SCHEDULE_RECOVERY,
  enabled: true,
  owner: {
    kind: "person",
    ownerId: actor.userId,
    scope: "d".repeat(64),
    generation: 0,
    householdScope: "e".repeat(64),
  },
  userId: actor.userId,
  familyId: actor.familyId,
  role: "parent",
};
