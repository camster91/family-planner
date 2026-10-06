import { layoutDayEvents } from "../view";
it("keeps late minimum targets outside the explicit 48 clock tracks without altering times", () => {
  const day = new Date("2026-01-05T00:00:00Z");
  const event = (id: string, start: string, end: string) => ({
    id,
    start_time: `2026-01-05T${start}:00Z`,
    end_time: `2026-01-05T${end}:00Z`,
  });
  const events = [
    event("late", "23:30", "23:45"),
    event("last-minute", "23:59", "23:59"),
    event("overlap", "23:30", "23:59"),
    event("last-grid", "23:00", "23:30"),
    event("grid-overlap", "23:00", "23:45"),
  ];
  const layout = layoutDayEvents(events, day, false);
  expect(
    layout.items.every(
      (item) =>
        item.startRow >= 1 &&
        item.endRow <= 49 &&
        item.endRow - item.startRow >= 2,
    ),
  ).toBe(true);
  expect(layout.items.map((item) => item.event.id).sort()).toEqual([
    "grid-overlap",
    "last-grid",
  ]);
  expect(layout.lanes).toBe(2);
  expect(layout.items.map((item) => item.column).sort()).toEqual([1, 2]);
  expect(layout).toHaveProperty("lateEvents", events.slice(0, 3));
  expect(events[0].start_time).toBe("2026-01-05T23:30:00Z");
  expect(events[1].end_time).toBe("2026-01-05T23:59:00Z");
});
it("keeps fixed clock rows with safe minimum targets and separate overlapping lanes", () => {
  const day = new Date("2026-01-05T00:00:00Z");
  const event = (id: string, start: string, end: string) => ({
    id,
    start_time: `2026-01-05T${start}:00Z`,
    end_time: `2026-01-05T${end}:00Z`,
  });
  const layout = layoutDayEvents(
    [
      event("long", "12:00", "13:30"),
      event("overlap", "13:00", "14:00"),
      event("short", "09:00", "09:00"),
    ],
    day,
    false,
  );
  expect(layout.lanes).toBe(2);
  expect(layout.items.find((i) => i.event.id === "short")).toMatchObject({
    startRow: 19,
    endRow: 21,
    column: 1,
    span: 2,
  });
  expect(layout.items.find((i) => i.event.id === "long")).toMatchObject({
    startRow: 25,
    endRow: 28,
    column: 1,
    span: 1,
  });
  expect(layout.items.find((i) => i.event.id === "overlap")).toMatchObject({
    startRow: 27,
    endRow: 29,
    column: 2,
    span: 1,
  });
});
import {
  visibleDays,
  segmentEvent,
  matchesSource,
  planningHref,
  parsePlanningDate,
  addDays,
} from "../view";

describe("source and navigation contracts", () => {
  it("uses origin identifiers, never source null or creator names", () => {
    expect(
      matchesSource(
        { source: null, source_connection_id: "provider" },
        "local",
      ),
    ).toBe(false);
    expect(
      matchesSource({ source_connection_id: "provider" }, "connected"),
    ).toBe(true);
    expect(matchesSource({ source_subscription_id: "ics" }, "ics:ics")).toBe(
      true,
    );
    expect(matchesSource({}, "local")).toBe(true);
    expect(
      matchesSource({ source_subscription_id: "different" }, "ics:ics"),
    ).toBe(false);
  });
  it("rejects normalized impossible dates and preserves numeric legacy URL fields", () => {
    expect(parsePlanningDate("2026-02-30")).toBeNull();
    expect(parsePlanningDate("2026-01-01")).toBe("2026-01-01");
    expect(planningHref("2025-12-31", "day")).toBe(
      "/dashboard/calendar?year=2025&month=12&date=2025-12-31&view=day",
    );
  });
  it("uses local midnight arithmetic across spring and fall DST", () => {
    const spring = new Date(2026, 2, 8);
    const fall = new Date(2026, 10, 1);
    expect(addDays(spring, 1, true).getHours()).toBe(0);
    expect(addDays(fall, 1, true).getHours()).toBe(0);
    // Run this file with TZ=America/New_York for duration assertions.
    if (
      Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York"
    ) {
      expect((+addDays(spring, 1, true) - +spring) / 3600000).toBe(23);
      expect((+addDays(fall, 1, true) - +fall) / 3600000).toBe(25);
    }
  });
});
it("keeps UTC+14 and UTC-12 viewer days calendar-based", () => {
  const day = new Date(2026, 11, 31);
  const next = addDays(day, 1, true);
  expect(next.getFullYear()).toBe(2027);
  expect(next.getMonth()).toBe(0);
  expect(next.getDate()).toBe(1);
});
describe("viewer calendar arithmetic", () => {
  it("builds a Monday week across the year boundary", () => {
    const days = visibleDays("2026-01-01", "week", false);
    expect(days.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });
  it("clips continuing events without changing stored instants; excludes exclusive end", () => {
    const event = {
      start_time: "2025-12-30T22:00:00Z",
      end_time: "2026-01-02T00:00:00Z",
    };
    const day = new Date("2026-01-01T00:00:00Z");
    expect(segmentEvent(event, day, false)).toEqual({
      start: day,
      end: new Date(event.end_time),
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(event.start_time).toBe("2025-12-30T22:00:00Z");
    expect(segmentEvent(event, new Date(event.end_time), false)).toBeNull();
  });
  it("includes zero duration starts only inside the day", () => {
    const e = {
      start_time: "2026-01-01T12:00:00Z",
      end_time: "2026-01-01T12:00:00Z",
    };
    expect(segmentEvent(e, new Date("2026-01-01"), false)).not.toBeNull();
    expect(segmentEvent(e, new Date("2026-01-02"), false)).toBeNull();
  });
});
