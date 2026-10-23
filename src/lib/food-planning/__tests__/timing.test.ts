/** Authored/unrun: deterministic interval checks, not household/provider acceptance. */
import {
  foodPlanRequest,
  foodTimingRequest,
  type FoodCalendarSnapshot,
} from "../contract";
import { planFoodTiming } from "../timing";
const calendar = (): FoodCalendarSnapshot => ({
  observedAt: "2026-10-22T12:00:00Z",
  complete: true,
  reasons: [],
  ignoredEventIds: [],
  events: [
    {
      id: "busy",
      start: "2026-10-22T15:00:00Z",
      end: "2026-10-22T15:30:00Z",
      sourceToken: "a".repeat(64),
      repeating: false,
    },
  ],
  departures: [
    {
      id: "departure",
      title: "Chosen departure event",
      start: "2026-10-22T17:00:00Z",
      end: "2026-10-22T18:00:00Z",
      sourceToken: "b".repeat(64),
      repeating: false,
    },
  ],
});
const timing = () =>
  foodTimingRequest.parse({
    start: "2026-10-22T15:00:00Z",
    end: "2026-10-22T18:00:00Z",
    departureEventId: "departure",
    beforeCookingMinutes: 5,
    eatingMinutes: 10,
    cleanupMinutes: 5,
    travelMinutes: 30,
    departurePreparationMinutes: 10,
  });
it("fits one continuous cooking/eating/cleanup interval before the canonical departure with explicit buffers", () => {
  const result = planFoodTiming(timing(), 30, calendar());
  expect(result).toMatchObject({
    state: "fits",
    occupiedMinutes: 50,
    start: "2026-10-22T15:30:00.000Z",
    finish: "2026-10-22T16:20:00.000Z",
    readyBy: "2026-10-22T16:20:00.000Z",
    departure: { id: "departure" },
  });
  expect(result.blockingEventIds).toEqual(["busy"]);
});
it("does not turn stale/incomplete sources, unknown cooking duration or a missing selected departure into availability", () => {
  expect(
    planFoodTiming(timing(), 30, {
      ...calendar(),
      complete: false,
      reasons: ["source-unavailable"],
    }),
  ).toMatchObject({
    state: "unknown",
    start: null,
    reasons: ["calendar-incomplete"],
  });
  expect(planFoodTiming(timing(), null, calendar())).toMatchObject({
    state: "unknown",
    start: null,
    reasons: ["duration-unknown"],
  });
  expect(
    planFoodTiming(timing(), 30, { ...calendar(), departures: [] }),
  ).toMatchObject({ state: "unknown", reasons: ["departure-unavailable"] });
});
it("requires a contiguous gap, respects half-open boundaries and never starts even a zero-minute dish inside a busy event", () => {
  const source = calendar();
  source.events.push({
    id: "second",
    start: "2026-10-22T16:00:00Z",
    end: "2026-10-22T16:20:00Z",
    sourceToken: "c".repeat(64),
    repeating: false,
  });
  expect(planFoodTiming(timing(), 30, source)).toMatchObject({
    state: "conflict",
    reasons: ["no-contiguous-window"],
  });
  const manual = foodTimingRequest.parse({
    start: "2026-10-22T15:00:00Z",
    end: "2026-10-22T16:00:00Z",
  });
  expect(planFoodTiming(manual, 30, calendar())).toMatchObject({
    state: "fits",
    finish: "2026-10-22T16:00:00.000Z",
  });
  expect(planFoodTiming(manual, 0, calendar())).toMatchObject({
    state: "fits",
    start: "2026-10-22T15:30:00.000Z",
  });
  expect(
    planFoodTiming(manual, 30, {
      ...calendar(),
      observedAt: "2026-10-22T16:00:00Z",
    }),
  ).toMatchObject({ state: "conflict", reasons: ["window-passed"] });
});
it("uses actual instants across a daylight-saving fold and requires a matching local meal day", () => {
  const fold = foodTimingRequest.parse({
    start: "2026-11-01T01:00:00-04:00",
    end: "2026-11-01T01:30:00-05:00",
  });
  const source = {
    ...calendar(),
    observedAt: "2026-11-01T00:00:00Z",
    events: [],
  };
  expect(planFoodTiming(fold, 90, source)).toMatchObject({
    state: "fits",
    start: "2026-11-01T05:00:00.000Z",
    finish: "2026-11-01T06:30:00.000Z",
  });
  expect(
    foodPlanRequest.safeParse({
      timeZone: "America/Toronto",
      slots: [
        {
          key: "fold",
          date: "2026-11-01",
          mealType: "breakfast",
          servings: 2,
          timing: fold,
        },
      ],
    }).success,
  ).toBe(true);
  expect(
    foodPlanRequest.safeParse({
      timeZone: "America/Toronto",
      slots: [
        {
          key: "wrong-day",
          date: "2026-11-02",
          mealType: "breakfast",
          servings: 2,
          timing: fold,
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    foodTimingRequest.safeParse({
      start: "2026-10-22T15:00",
      end: "2026-10-22T16:00",
    }).success,
  ).toBe(false);
});
it("uses explicit ignored events only and does not ignore the selected departure deadline", () => {
  const result = planFoodTiming(timing(), 30, {
    ...calendar(),
    ignoredEventIds: ["busy", "departure"],
  });
  expect(result).toMatchObject({
    state: "fits",
    start: "2026-10-22T15:00:00.000Z",
    readyBy: "2026-10-22T16:20:00.000Z",
  });
});
