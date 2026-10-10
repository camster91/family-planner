import { runInThisContext } from "node:vm";
import {
  eventFormRange,
  formatDateOnly,
  isDueToday,
  isDueWithinDays,
  calendarMonthQueryWindow,
  toDateOnlyLocal,
} from "../dates";
import { dateAt, addDays } from "../calendar-planning/view";

const runtimeProcess = runInThisContext("process") as NodeJS.Process;
const originalTZ = runtimeProcess.env.TZ;
beforeAll(() => {
  runtimeProcess.env.TZ = "America/Toronto";
});
afterAll(() => {
  if (originalTZ === undefined) delete runtimeProcess.env.TZ;
  else runtimeProcess.env.TZ = originalTZ;
});
beforeEach(() => {
  expect(new Date("2026-03-08T06:59:00Z").getTimezoneOffset()).toBe(300);
  expect(new Date("2026-03-08T07:00:00Z").getTimezoneOffset()).toBe(240);
  expect(new Date("2026-11-01T05:30:00Z").getTimezoneOffset()).toBe(240);
  expect(new Date("2026-11-01T06:30:00Z").getTimezoneOffset()).toBe(300);
});

it.each([
  ["2026-03-08", "02:00"],
  ["2026-03-08", "02:30"],
  ["2026-03-08", "02:59"],
  ["2026-02-31", "12:00"],
  ["2026-04-31", "12:00"],
  ["2026-01-05", "24:00"],
  ["2026-01-05", "12:60"],
  ["2026-01-05", "12:00Z"],
  ["2026-01-05", "12:00-05:00"],
])(
  "rejects an impossible or non-local manual start %s %s",
  (startDate, startTime) => {
    expect(
      eventFormRange({ startDate, startTime, endDate: "", endTime: "" }),
    ).toBeNull();
  },
);
it.each(["02:00", "02:30", "02:59"])(
  "rejects a spring-gap end %s",
  (endTime) => {
    expect(
      eventFormRange({
        startDate: "2026-03-08",
        startTime: "01:30",
        endDate: "",
        endTime,
      }),
    ).toBeNull();
    expect(
      eventFormRange({
        startDate: "2026-03-07",
        startTime: "12:00",
        endDate: "2026-03-08",
        endTime,
      }),
    ).toBeNull();
  },
);
it.each([
  ["2026-03-08", "01:59", "2026-03-08T06:59:00.000Z"],
  ["2026-03-08", "03:00", "2026-03-08T07:00:00.000Z"],
  ["2026-11-01", "01:30", "2026-11-01T05:30:00.000Z"],
  ["2026-11-01", "02:00", "2026-11-01T07:00:00.000Z"],
])(
  "keeps existing valid runtime-local new-event policy for %s %s",
  (startDate, startTime, start) => {
    expect(
      eventFormRange({ startDate, startTime, endDate: "", endTime: "" }),
    ).toEqual({ start, end: start });
  },
);
it("keeps 23/25-hour Toronto calendar days as calendar arithmetic", () => {
  const spring = dateAt("2026-03-08", true),
    fall = dateAt("2026-11-01", true);
  expect((+addDays(spring, 1, true) - +spring) / 3600000).toBe(23);
  expect((+addDays(fall, 1, true) - +fall) / 3600000).toBe(25);
});
it.each(["en-CA", "en-GB", "es-MX"])(
  "keeps date-only days and boundaries independent of display locale %s",
  (locale) => {
    for (const day of [
      "2026-03-08",
      "2026-11-01",
      "2026-12-31",
      "2027-01-01",
    ]) {
      const now = new Date(`${day}T23:30:00`);
      const stored = `${day}T00:00:00.000Z`;
      expect(toDateOnlyLocal(now)).toBe(day);
      expect(isDueToday(stored, now)).toBe(true);
      expect(isDueWithinDays(stored, 7, now)).toBe(true);
      const label = formatDateOnly(
        stored,
        { year: "numeric", month: "2-digit", day: "2-digit" },
        locale,
      );
      for (const part of day.split("-")) expect(label).toContain(part);
    }
    const range = calendarMonthQueryWindow(2026, 10);
    const lateOctober = +new Date("2026-11-01T03:59:00Z");
    expect(lateOctober).toBeGreaterThanOrEqual(+range.start);
    expect(lateOctober).toBeLessThan(+range.end);
  },
);

it.each([
  ["2026-03-08T23:30:00", "2026-03-15", "2026-03-16"],
  ["2026-11-01T23:30:00", "2026-11-08", "2026-11-09"],
])(
  "keeps seven-day due windows calendar-based across the Toronto boundary %s",
  (clock, last, beyond) => {
    const now = new Date(clock);
    expect(isDueWithinDays(`${last}T00:00:00Z`, 7, now)).toBe(true);
    expect(isDueWithinDays(`${beyond}T00:00:00Z`, 7, now)).toBe(false);
  },
);
it("one edited boundary uses existing new-time policy while the untouched boundary retains precision", () => {
  const original = {
    start: "2026-11-01T06:30:45.123Z",
    end: "2026-11-01T06:45:55.456Z",
  };
  expect(
    eventFormRange(
      {
        startDate: "2026-11-01",
        startTime: "01:31",
        endDate: "2026-11-01",
        endTime: "01:45",
      },
      original,
    ),
  ).toEqual({ start: "2026-11-01T05:31:00.000Z", end: original.end });
});
it("invalid or differently displayed original values do not override actual manual fields", () => {
  expect(
    eventFormRange(
      {
        startDate: "2026-10-06",
        startTime: "12:00",
        endDate: "",
        endTime: "13:00",
      },
      { start: "invalid", end: "2026-10-07T17:00:00Z" },
    ),
  ).toEqual({
    start: "2026-10-06T16:00:00.000Z",
    end: "2026-10-06T17:00:00.000Z",
  });
});

 it.each([
  ['2026-12-31', '23:30', 90, '2027-01-01T06:00:00.000Z'],
  ['2026-03-08', '01:30', 60, '2026-03-08T07:30:00.000Z'],
  ['2026-11-01', '01:30', 60, '2026-11-01T06:30:00.000Z'],
])('duration crosses midnight and DST with exact elapsed minutes: %s %s', (startDate, startTime, minutes, end) => {
 const range = eventFormRange({ startDate, startTime, endDate: '', endTime: '' }, undefined, minutes)
 expect(range?.end).toBe(end)
 expect((+new Date(range!.end) - +new Date(range!.start)) / 60000).toBe(minutes)
})
it('duration preserves an edited event second-fold start and its precision', () => {
 const start = '2026-11-01T06:30:45.123Z'
 expect(eventFormRange({ startDate: '2026-11-01', startTime: '01:30', endDate: '', endTime: '' }, { start, end: null }, 30)).toEqual({ start, end: '2026-11-01T07:00:45.123Z' })
})
it.each([0, -1, 1.5, NaN, Infinity, 525601])('rejects invalid duration %s', minutes => {
 expect(eventFormRange({ startDate: '2026-12-15', startTime: '10:00', endDate: '', endTime: '' }, undefined, minutes)).toBeNull()
})
