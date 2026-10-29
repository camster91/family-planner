import { calendarFeedRule } from "@/lib/calendar-feed-rule";
import { getD1Database, type D1Store } from "./database";

export const D1_CALENDAR_FEED_PAGE_SIZE = 200;
export const D1_CALENDAR_FEED_MAX_EVENTS = 10_000;
export const D1_CALENDAR_FEED_MAX_BYTES = 16 * 1024 * 1024;

export class D1CalendarFeedTooLarge extends Error {
  constructor() {
    super("Calendar feed exceeds complete export limits");
    this.name = "D1CalendarFeedTooLarge";
  }
}
export class D1CalendarFeedInvalidRule extends Error {
  constructor() {
    super("Calendar feed contains an unsupported recurrence rule");
    this.name = "D1CalendarFeedInvalidRule";
  }
}

type FamilyRow = { id: string; name: string };
type FeedEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: number;
  end_time: number;
  created_at: number;
  recurrence: string | null;
};

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 74) return line;
  const parts: string[] = [];
  let segment = "";
  let bytes = 0;
  let width = 74;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > width) {
      parts.push(parts.length ? ` ${segment}` : segment);
      segment = "";
      bytes = 0;
      width = 73;
    }
    segment += character;
    bytes += size;
  }
  if (segment) parts.push(parts.length ? ` ${segment}` : segment);
  return parts.join("\r\n");
}
function stamp(value: number): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Build the complete bearer-token ICS snapshot from native D1 only. */
export async function buildD1CalendarFeed(
  token: string,
  now: Date,
  database?: D1Store,
) {
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const family = await db
    .prepare(`SELECT id,name FROM "Family" WHERE feed_token=?1`)
    .bind(token)
    .first<FamilyRow>();
  if (!family) return { kind: "unauthorized" as const };
  const from = now.getTime() - 30 * 86_400_000;
  const to = now.getTime() + 365 * 86_400_000;
  const chunks: string[] = [];
  let bytes = 0;
  const append = (line: string) => {
    bytes += Buffer.byteLength(line, "utf8") + 2;
    if (bytes > D1_CALENDAR_FEED_MAX_BYTES) throw new D1CalendarFeedTooLarge();
    chunks.push(`${line}\r\n`);
  };
  const text = (name: string, value: string) => {
    if (Buffer.byteLength(value, "utf8") > D1_CALENDAR_FEED_MAX_BYTES - bytes)
      throw new D1CalendarFeedTooLarge();
    append(fold(`${name}:${escapeIcs(value)}`));
  };
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ].forEach(append);
  text("X-WR-CALNAME", family.name);
  // Keep the export a single D1 statement. Paging through separate D1 reads
  // could produce a mixed snapshot if an event changes between pages; the
  // max+1 sentinel still gives us a hard bounded export without that race.
  const rows = (
    await db
      .prepare(
        `SELECT e.id,e.title,e.description,e.location,e.start_time,e.end_time,e.created_at,e.recurrence FROM "Event" e
      WHERE e.family_id=?1 AND (e.recurrence IS NOT NULL OR (e.start_time>=?2 AND e.start_time<=?3))
      ORDER BY e.start_time,e.id LIMIT ?4`,
      )
      .bind(family.id, from, to, D1_CALENDAR_FEED_MAX_EVENTS + 1)
      .all<FeedEvent>()
  ).results;
  if (rows.length > D1_CALENDAR_FEED_MAX_EVENTS)
    throw new D1CalendarFeedTooLarge();
  for (const event of rows) {
    const end =
      event.end_time > event.start_time ? event.end_time : event.start_time;
    append("BEGIN:VEVENT");
    append(`UID:${event.id}@family.ashbi.ca`);
    append(`DTSTAMP:${stamp(event.created_at)}`);
    append(`DTSTART:${stamp(event.start_time)}`);
    append(`DTEND:${stamp(end)}`);
    text("SUMMARY", event.title);
    if (event.description) text("DESCRIPTION", event.description);
    if (event.location) text("LOCATION", event.location);
    if (event.recurrence !== null) {
      try {
        append(fold(`RRULE:${calendarFeedRule(event.recurrence)}`));
      } catch {
        throw new D1CalendarFeedInvalidRule();
      }
    }
    append("END:VEVENT");
  }
  append("END:VCALENDAR");
  return { kind: "ok" as const, ics: chunks.join("") };
}
