/** Authored source only; no date/UI/browser QA has run. */
import {
  scheduleWallChoices,
  resolveScheduleWall,
  windowDraft,
  resolveScheduleDraft,
  queryForSchedule,
  formatScheduleInstant,
  EMPTY_BUFFER_DRAFT,
} from "../schedule-form";
import { snapshot, query } from "./schedule-fixture";
it("refuses DST gaps and impossible dates instead of shifting or rolling them", () => {
  expect(scheduleWallChoices("2026-03-08T02:30:00", "America/Toronto")).toEqual(
    [],
  );
  expect(scheduleWallChoices("2026-02-30T10:00:00", "America/Toronto")).toEqual(
    [],
  );
  expect(() =>
    resolveScheduleWall("2026-03-08T02:30:00", null, "America/Toronto"),
  ).toThrow();
});
it("requires an explicit offset for a repeated local time and distinguishes both instants", () => {
  const choices = scheduleWallChoices("2026-11-01T01:30:00", "America/Toronto");
  expect(choices).toEqual([
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
  expect(() =>
    resolveScheduleWall("2026-11-01T01:30:00", null, "America/Toronto"),
  ).toThrow();
  expect(
    resolveScheduleWall("2026-11-01T01:30:00", choices[1], "America/Toronto"),
  ).toBe(choices[1]);
  expect(
    formatScheduleInstant(choices[0], "en-CA", "America/Toronto"),
  ).not.toBe(formatScheduleInstant(choices[1], "en-CA", "America/Toronto"));
});
it("preserves known original offsets in a draft and exact milliseconds in displayed instants", () => {
  const scope = {
      targetId: query.target.id,
      range: {
        start: "2026-11-01T06:30:00.000Z",
        end: "2026-11-01T08:00:00.000Z",
      },
      timeZone: "America/Toronto",
    },
    draft = windowDraft(scope);
  expect(
    resolveScheduleWall(draft.start, draft.startChoice, scope.timeZone),
  ).toBe(scope.range.start);
  expect(
    formatScheduleInstant("2026-10-20T10:00:00.017Z", "en-CA", "UTC"),
  ).toContain("017");
});
it("includes the original reserved interval and explicit search windows in the compared range, without changing duration", () => {
  const scope = {
      targetId: query.target.id,
      range: query.range,
      timeZone: query.timeZone,
    },
    windows = [
      {
        start: "2026-10-21T09:00:00",
        end: "2026-10-21T13:00:00",
        startChoice: null,
        endChoice: null,
      },
    ];
  const draft = resolveScheduleDraft(
    snapshot,
    scope.targetId,
    { preparation: "15", travelBefore: "20", travelAfter: "10" },
    windows,
    {},
  );
  expect(draft.scope.range.start).toBe("2026-10-20T09:25:00.000Z");
  expect(draft.scope.range.end).toBe("2026-10-21T17:00:00.000Z");
  const result = queryForSchedule(snapshot, scope.targetId, draft, 15);
  expect(result.buffers).toEqual({
    preparation: 15,
    travelBefore: 20,
    travelAfter: 10,
  });
  expect(snapshot.events[0].end).toBe("2026-10-20T11:00:00Z");
});
it("keeps invalid/changed comparison drafts held instead of silently dropping or rebinding them", () => {
  const scope = {
      targetId: query.target.id,
      range: query.range,
      timeZone: query.timeZone,
    },
    windows = [windowDraft(scope)];
  expect(() =>
    resolveScheduleDraft(
      snapshot,
      scope.targetId,
      { ...EMPTY_BUFFER_DRAFT, preparation: "1.5" },
      windows,
      {},
    ),
  ).toThrow();
  expect(() =>
    resolveScheduleDraft(
      snapshot,
      scope.targetId,
      { ...EMPTY_BUFFER_DRAFT },
      windows,
      {
        "missing-event": {
          sourceToken: "b".repeat(64),
          buffers: { ...EMPTY_BUFFER_DRAFT },
        },
      },
    ),
  ).toThrow();
  const distant = [
    {
      start: "2027-01-01T10:00:00",
      end: "2027-01-01T12:00:00",
      startChoice: null,
      endChoice: null,
    },
  ];
  expect(() =>
    resolveScheduleDraft(
      snapshot,
      scope.targetId,
      { ...EMPTY_BUFFER_DRAFT },
      distant,
      {},
    ),
  ).toThrow();
});
