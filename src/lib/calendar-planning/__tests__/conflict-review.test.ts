/** Authored source only; execution belongs to the later consolidated QA pass. */
import {
  planScheduleReview,
  previewScheduleMove,
  scheduleMoveCommand,
  SCHEDULE_REVIEW_PROTOCOL,
  NO_SCHEDULE_BUFFERS,
  type ScheduleReviewSnapshot,
  type ScheduleReviewQuery,
  type ScheduleReviewEvent,
} from "../conflict-review";
const owner = { userId: "person-a", familyId: "family-a" };
const token = "a".repeat(64),
  otherToken = "b".repeat(64);
function event(id: string, start: string, end: string): ScheduleReviewEvent {
  return {
    id,
    title: id,
    start,
    end,
    sourceToken: token,
    origin: "local",
    repeating: false,
    canMove: true,
  };
}
function fixture() {
  const target = event(
    "target-a",
    "2026-10-20T10:00:00Z",
    "2026-10-20T11:00:00Z",
  );
  const obstacle = event(
    "obstacle-a",
    "2026-10-20T10:30:00Z",
    "2026-10-20T11:30:00Z",
  );
  const snapshot: ScheduleReviewSnapshot = {
    protocol: SCHEDULE_REVIEW_PROTOCOL,
    owner,
    role: "parent",
    timeZone: "America/Toronto",
    snapshotToken: token,
    range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
    coverage: {
      complete: true,
      recurrence: "complete",
      sourcesUnavailable: false,
      capped: false,
    },
    events: [target, obstacle],
  };
  const query: ScheduleReviewQuery = {
    protocol: SCHEDULE_REVIEW_PROTOCOL,
    owner,
    snapshotToken: token,
    range: { ...snapshot.range },
    timeZone: snapshot.timeZone,
    target: { id: target.id, sourceToken: token },
    buffers: { ...NO_SCHEDULE_BUFFERS },
    otherBuffers: [],
    windows: [{ start: "2026-10-20T08:00:00Z", end: "2026-10-20T16:00:00Z" }],
    gridMinutes: 15,
  };
  return { snapshot, query, now: new Date("2026-10-20T07:00:00Z") };
}
it("keeps actual overlaps distinct from adjacent events and preserves the original source", () => {
  const { snapshot, query, now } = fixture();
  snapshot.events.push(
    event("adjacent", "2026-10-20T11:00:00Z", "2026-10-20T12:00:00Z"),
  );
  const before = JSON.stringify(snapshot),
    plan = planScheduleReview(snapshot, query, now);
  expect(plan.conflictCount).toBe(1);
  expect(plan.conflicts[0]).toMatchObject({
    reason: "event-overlap",
    start: "2026-10-20T10:30:00.000Z",
    end: "2026-10-20T11:00:00.000Z",
  });
  expect(plan.alternatives[0]).toMatchObject({
    start: "2026-10-20T09:30:00.000Z",
    end: "2026-10-20T10:30:00.000Z",
  });
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(plan.canApply).toBe(true);
});
it("explains buffer-only conflicts, with zero actual overlap and editable amounts", () => {
  const { snapshot, query, now } = fixture();
  snapshot.events[1] = event(
    "obstacle-a",
    "2026-10-20T11:15:00Z",
    "2026-10-20T12:00:00Z",
  );
  query.buffers.travelAfter = 15;
  expect(planScheduleReview(snapshot, query, now).conflictCount).toBe(0);
  query.buffers.travelAfter = 20;
  expect(planScheduleReview(snapshot, query, now).conflicts[0]).toMatchObject({
    reason: "buffer-overlap",
    start: "2026-10-20T11:15:00.000Z",
    end: "2026-10-20T11:20:00.000Z",
  });
  query.buffers.travelAfter = 0;
  query.otherBuffers = [
    {
      id: "obstacle-a",
      sourceToken: token,
      buffers: { preparation: 20, travelBefore: 0, travelAfter: 0 },
    },
  ];
  expect(planScheduleReview(snapshot, query, now).conflicts[0].reason).toBe(
    "buffer-overlap",
  );
});
it("keeps seconds and all buffers inside explicit windows without suggesting past preparation", () => {
  const { snapshot, query } = fixture();
  snapshot.events[0].end = "2026-10-20T11:00:17Z";
  query.buffers = { preparation: 15, travelBefore: 20, travelAfter: 10 };
  const now = new Date("2026-10-20T08:10:00Z"),
    result = planScheduleReview(snapshot, query, now);
  expect(result.alternatives.length).toBeGreaterThan(0);
  for (const choice of result.alternatives) {
    expect(Date.parse(choice.end) - Date.parse(choice.start)).toBe(
      3600_000 + 17000,
    );
    expect(Date.parse(choice.reservedStart)).toBeGreaterThanOrEqual(
      now.getTime(),
    );
    expect(Date.parse(choice.reservedEnd)).toBeLessThanOrEqual(
      Date.parse(query.windows[0].end),
    );
    expect(Date.parse(choice.start) - Date.parse(choice.reservedStart)).toBe(
      35 * 60000,
    );
  }
});
it("compares actual instants through the repeated DST hour, not equal wall labels", () => {
  const { snapshot, query } = fixture();
  snapshot.range = {
    start: "2026-11-01T00:00:00Z",
    end: "2026-11-02T00:00:00Z",
  };
  query.range = { ...snapshot.range };
  snapshot.events = [
    event("target-a", "2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"),
    event("obstacle-a", "2026-11-01T05:45:00Z", "2026-11-01T06:45:00Z"),
  ];
  query.windows = [
    { start: "2026-11-01T04:00:00Z", end: "2026-11-01T09:00:00Z" },
  ];
  const plan = planScheduleReview(
    snapshot,
    query,
    new Date("2026-11-01T04:00:00Z"),
  );
  expect(plan.conflictCount).toBe(1);
  expect(
    plan.alternatives.every(
      (choice) => Date.parse(choice.end) - Date.parse(choice.start) === 3600000,
    ),
  ).toBe(true);
});
it("does not turn incomplete/capped/failed or unexpanded source coverage into an applicable move", () => {
  const { snapshot, query, now } = fixture();
  snapshot.coverage = {
    complete: false,
    recurrence: "stored-only",
    sourcesUnavailable: true,
    capped: true,
  };
  const plan = planScheduleReview(snapshot, query, now);
  expect(plan.canApply).toBe(false);
  expect(plan.holds).toEqual(
    expect.arrayContaining([
      "incomplete",
      "recurrence-unknown",
      "sources-unavailable",
      "capped",
    ]),
  );
  expect(plan.alternatives.every((choice) => choice.provisional)).toBe(true);
  expect(() =>
    previewScheduleMove(snapshot, query, plan.alternatives[0], now),
  ).toThrow();
});
it.each(["teen", "child"] as const)(
  "read permission alone never permits %s to apply",
  (role) => {
    const { snapshot, query, now } = fixture();
    snapshot.role = role;
    expect(planScheduleReview(snapshot, query, now).holds).toContain(
      "read-only",
    );
  },
);
it("holds subscribed and repeating targets even when a caller mistakenly marks them movable", () => {
  const { snapshot, query, now } = fixture();
  snapshot.events[0].origin = "subscribed";
  snapshot.events[0].repeating = true;
  const plan = planScheduleReview(snapshot, query, now);
  expect(plan.canApply).toBe(false);
  expect(plan.holds).toEqual(
    expect.arrayContaining(["read-only", "repeating-target"]),
  );
});
it("refuses foreign owners, stale tokens, unknown/duplicate references and out-of-range windows", () => {
  for (const change of [
    (query: ScheduleReviewQuery) => {
      query.owner = { ...owner, familyId: "other-family" };
    },
    (query: ScheduleReviewQuery) => {
      query.snapshotToken = otherToken;
    },
    (query: ScheduleReviewQuery) => {
      query.target.sourceToken = otherToken;
    },
    (query: ScheduleReviewQuery) => {
      query.otherBuffers = [
        {
          id: "foreign-id",
          sourceToken: token,
          buffers: { ...NO_SCHEDULE_BUFFERS },
        },
      ];
    },
    (query: ScheduleReviewQuery) => {
      query.windows[0].end = "2026-10-27T00:00:00Z";
    },
  ]) {
    const { snapshot, query, now } = fixture();
    change(query);
    expect(() => planScheduleReview(snapshot, query, now)).toThrow();
  }
  const { snapshot, query, now } = fixture();
  snapshot.events.push({ ...snapshot.events[0] });
  expect(() => planScheduleReview(snapshot, query, now)).toThrow();
});
it("deduplicates overlapping windows and preserves deterministic choices regardless of input order", () => {
  const { snapshot, query, now } = fixture();
  query.windows.push({ ...query.windows[0] });
  const plan = planScheduleReview(snapshot, query, now);
  expect(new Set(plan.alternatives.map((choice) => choice.start)).size).toBe(
    plan.alternatives.length,
  );
  expect(plan.alternatives.length).toBeLessThanOrEqual(3);
  expect(
    planScheduleReview(
      { ...snapshot, events: [...snapshot.events].reverse() },
      { ...query, windows: [...query.windows].reverse() },
      now,
    ),
  ).toEqual(plan);
});
it("previews only an actual applicable candidate and refuses invented or changed durations", () => {
  const { snapshot, query, now } = fixture();
  const plan = planScheduleReview(snapshot, query, now),
    choice = plan.alternatives[0];
  const intent = previewScheduleMove(snapshot, query, choice, now);
  expect(intent).toMatchObject({
    action: "reschedule",
    target: query.target,
    snapshotToken: query.snapshotToken,
    start: choice.start,
    end: choice.end,
    issuedAt: now.toISOString(),
  });
  expect(() =>
    previewScheduleMove(
      snapshot,
      query,
      { ...choice, end: "2026-10-20T23:00:00Z" },
      now,
    ),
  ).toThrow();
  expect(
    scheduleMoveCommand.safeParse({ ...intent, end: intent.start }).success,
  ).toBe(false);
});
it("reports no opening when busy intervals cover every requested window; buffer boundary uncertainty holds apply", () => {
  const { snapshot, query, now } = fixture();
  snapshot.events[1] = event(
    "all-day",
    "2026-10-20T07:00:00Z",
    "2026-10-20T17:00:00Z",
  );
  expect(planScheduleReview(snapshot, query, now)).toMatchObject({
    alternatives: [],
    canApply: false,
    holds: expect.arrayContaining(["no-opening"]),
  });
  snapshot.range.start = snapshot.events[0].start;
  query.range = { ...snapshot.range };
  query.windows[0].start = snapshot.range.start;
  query.buffers.preparation = 30;
  expect(planScheduleReview(snapshot, query, now).holds).toContain(
    "incomplete",
  );
});
