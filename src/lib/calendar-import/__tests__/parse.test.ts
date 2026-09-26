// ICS parsing / expansion for read-only subscriptions (#232).

import { IcsParseError, parseIcsFeed, normalizeTzid } from "../parse";
import { zonedWallTimeToUtc } from "../timezone";

const WINDOW = {
  windowStart: new Date("2026-01-01T00:00:00Z"),
  windowEnd: new Date("2027-01-01T00:00:00Z"),
};

function cal(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const iso = (d: Date) => d.toISOString();

describe("zonedWallTimeToUtc (America/Toronto)", () => {
  const tz = "America/Toronto";
  it("uses EST in winter and EDT in summer", () => {
    expect(
      iso(
        zonedWallTimeToUtc(
          { year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 },
          tz,
        ),
      ),
    ).toBe("2026-01-15T14:00:00.000Z");
    expect(
      iso(
        zonedWallTimeToUtc(
          { year: 2026, month: 7, day: 15, hour: 9, minute: 0, second: 0 },
          tz,
        ),
      ),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("moves a time in the March spring-forward gap forward (RFC 5545)", () => {
    // 2026-03-08 02:30 does not exist in Toronto; it is read with the pre-gap offset (EST).
    expect(
      iso(
        zonedWallTimeToUtc(
          { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
          tz,
        ),
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("uses the first occurrence of an ambiguous November time (RFC 5545)", () => {
    // 2026-11-01 01:30 happens twice; the first is EDT (-4).
    expect(
      iso(
        zonedWallTimeToUtc(
          { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
          tz,
        ),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("handles an eastern-hemisphere fall-back too (first occurrence)", () => {
    expect(
      iso(
        zonedWallTimeToUtc(
          { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
          "Europe/Berlin",
        ),
      ),
    ).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("normalizeTzid", () => {
  it("accepts IANA, prefixed Mozilla-style and common Windows names", () => {
    expect(normalizeTzid("America/Toronto")).toBe("America/Toronto");
    expect(normalizeTzid("/mozilla.org/20050126_1/America/Toronto")).toBe(
      "America/Toronto",
    );
    expect(normalizeTzid("Eastern Standard Time")).toBe("America/Toronto");
    expect(normalizeTzid("Not A Zone")).toBeNull();
  });
});

describe("parseIcsFeed", () => {
  it("imports a simple UTC event", () => {
    const { occurrences, truncated } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:simple-1@example.test",
        "DTSTAMP:20260101T000000Z",
        "DTSTART:20260310T150000Z",
        "DTEND:20260310T160000Z",
        "SUMMARY:Parent-teacher night",
        "LOCATION:Gym",
        "DESCRIPTION:Bring the form\\, please",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(truncated).toBe(false);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      uid: "simple-1@example.test",
      title: "Parent-teacher night",
      location: "Gym",
      description: "Bring the form, please",
      allDay: false,
    });
    expect(iso(occurrences[0].start)).toBe("2026-03-10T15:00:00.000Z");
    expect(iso(occurrences[0].end)).toBe("2026-03-10T16:00:00.000Z");
    expect(iso(occurrences[0].occurrenceStart)).toBe(
      "2026-03-10T15:00:00.000Z",
    );
  });

  it("imports an all-day event as a household-local calendar day", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:allday-1",
        "DTSTART;VALUE=DATE:20260316",
        "DTEND;VALUE=DATE:20260317",
        "SUMMARY:PA Day",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].allDay).toBe(true);
    // Midnight to midnight in America/Toronto (EDT after Mar 8).
    expect(iso(occurrences[0].start)).toBe("2026-03-16T04:00:00.000Z");
    expect(iso(occurrences[0].end)).toBe("2026-03-17T04:00:00.000Z");
  });

  it("expands a weekly rule with EXDATE and a RECURRENCE-ID override", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:swim@example.test",
        "DTSTART;TZID=America/Toronto:20260105T170000",
        "DTEND;TZID=America/Toronto:20260105T180000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
        "EXDATE;TZID=America/Toronto:20260119T170000",
        "SUMMARY:Swim",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:swim@example.test",
        "RECURRENCE-ID;TZID=America/Toronto:20260112T170000",
        "DTSTART;TZID=America/Toronto:20260113T180000",
        "DTEND;TZID=America/Toronto:20260113T190000",
        "SUMMARY:Swim (moved to Tuesday)",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(
      occurrences.map((o) => [o.title, iso(o.start), iso(o.occurrenceStart)]),
    ).toEqual([
      ["Swim", "2026-01-05T22:00:00.000Z", "2026-01-05T22:00:00.000Z"],
      // Override keeps the ORIGINAL occurrence as identity, new time as start.
      [
        "Swim (moved to Tuesday)",
        "2026-01-13T23:00:00.000Z",
        "2026-01-12T22:00:00.000Z",
      ],
      // 2026-01-19 excluded by EXDATE.
      ["Swim", "2026-01-26T22:00:00.000Z", "2026-01-26T22:00:00.000Z"],
      ["Swim", "2026-02-02T22:00:00.000Z", "2026-02-02T22:00:00.000Z"],
    ]);
  });

  it("keeps wall-clock time across the March DST change (Toronto)", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:dst-march",
        "DTSTART;TZID=America/Toronto:20260301T090000",
        "DTEND;TZID=America/Toronto:20260301T100000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "SUMMARY:Sunday class",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(occurrences.map((o) => iso(o.start))).toEqual([
      "2026-03-01T14:00:00.000Z", // EST
      "2026-03-08T13:00:00.000Z", // EDT from 2026-03-08
      "2026-03-15T13:00:00.000Z",
    ]);
    expect(
      occurrences.every(
        (o) => o.end.getTime() - o.start.getTime() === 60 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("keeps wall-clock time across the November DST change (Toronto)", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:dst-nov",
        "DTSTART;TZID=America/Toronto:20261025T090000",
        "DTEND;TZID=America/Toronto:20261025T100000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "SUMMARY:Sunday class",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(occurrences.map((o) => iso(o.start))).toEqual([
      "2026-10-25T13:00:00.000Z", // EDT
      "2026-11-01T14:00:00.000Z", // EST from 2026-11-01
      "2026-11-08T14:00:00.000Z",
    ]);
  });

  it("resolves a VTIMEZONE-only (non-IANA) TZID from the feed's own rules", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VTIMEZONE",
        "TZID:Custom Eastern",
        "BEGIN:STANDARD",
        "DTSTART:19701101T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
        "TZOFFSETFROM:-0400",
        "TZOFFSETTO:-0500",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700308T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
        "TZOFFSETFROM:-0500",
        "TZOFFSETTO:-0400",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:custom-tz",
        "DTSTART;TZID=Custom Eastern:20260710T090000",
        "DTEND;TZID=Custom Eastern:20260710T100000",
        "SUMMARY:Camp",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(iso(occurrences[0].start)).toBe("2026-07-10T13:00:00.000Z");
  });

  it("reads floating times in the household time zone", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:floating",
        "DTSTART:20260115T090000",
        "DTEND:20260115T093000",
        "SUMMARY:Floating",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(iso(occurrences[0].start)).toBe("2026-01-15T14:00:00.000Z");
    const vancouver = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:floating",
        "DTSTART:20260115T090000",
        "SUMMARY:Floating",
        "END:VEVENT",
      ),
      { ...WINDOW, defaultTimeZone: "America/Vancouver" },
    );
    expect(iso(vancouver.occurrences[0].start)).toBe(
      "2026-01-15T17:00:00.000Z",
    );
  });

  it("is deterministic: parsing the same feed twice yields identical keys", () => {
    const feed = cal(
      "BEGIN:VEVENT",
      "UID:weekly",
      "DTSTART:20260105T170000Z",
      "RRULE:FREQ=WEEKLY;COUNT=10",
      "SUMMARY:Weekly",
      "END:VEVENT",
    );
    const keys = (f: string) =>
      parseIcsFeed(f, WINDOW).occurrences.map(
        (o) => `${o.uid}|${iso(o.occurrenceStart)}`,
      );
    expect(keys(feed)).toEqual(keys(feed));
    expect(new Set(keys(feed)).size).toBe(10);
  });

  it("only returns occurrences inside the window, and stops unbounded rules", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:forever",
        "DTSTART:20200101T120000Z",
        "RRULE:FREQ=DAILY",
        "SUMMARY:Daily",
        "END:VEVENT",
      ),
      {
        windowStart: new Date("2026-03-01T00:00:00Z"),
        windowEnd: new Date("2026-03-11T00:00:00Z"),
      },
    );
    expect(occurrences).toHaveLength(10);
    expect(iso(occurrences[0].start)).toBe("2026-03-01T12:00:00.000Z");
  });

  it("caps the number of occurrences and reports truncation", () => {
    const result = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:many",
        "DTSTART:20260101T000000Z",
        "RRULE:FREQ=HOURLY",
        "SUMMARY:x",
        "END:VEVENT",
      ),
      { ...WINDOW, maxOccurrences: 50 },
    );
    expect(result.occurrences).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("skips cancelled events/instances and events without a UID", () => {
    const { occurrences } = parseIcsFeed(
      cal(
        "BEGIN:VEVENT",
        "UID:series",
        "DTSTART:20260105T170000Z",
        "RRULE:FREQ=DAILY;COUNT=3",
        "SUMMARY:Series",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:series",
        "RECURRENCE-ID:20260106T170000Z",
        "DTSTART:20260106T170000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Series",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:gone",
        "STATUS:CANCELLED",
        "DTSTART:20260105T170000Z",
        "SUMMARY:Gone",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20260105T170000Z",
        "SUMMARY:No uid",
        "END:VEVENT",
      ),
      WINDOW,
    );
    expect(occurrences.map((o) => iso(o.start))).toEqual([
      "2026-01-05T17:00:00.000Z",
      "2026-01-07T17:00:00.000Z",
    ]);
  });

  it.each([
    ["empty", ""],
    ["html", "<html><body>Not found</body></html>"],
    ["broken", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:nonsense\r\n"],
    ["not a calendar", "BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n"],
  ])(
    "rejects malformed input (%s) with a content-free error",
    (_label, text) => {
      let caught: unknown;
      try {
        parseIcsFeed(text, WINDOW);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IcsParseError);
      expect((caught as Error).message).toBe("Feed is not a valid calendar");
    },
  );
});
