/** Complete token-scoped ICS assembly inside a caller-owned read snapshot. */
import type { Prisma } from "@prisma/client";
import { calendarFeedRule } from "./calendar-feed-rule";
export const CALENDAR_FEED_PAGE_SIZE = 200;
export const CALENDAR_FEED_MAX_EVENTS = 10000;
export const CALENDAR_FEED_MAX_BYTES = 16 * 1024 * 1024;
export class CalendarFeedTooLarge extends Error {
  constructor() { super("Calendar feed exceeds complete export limits"); }
}
type FeedEvent = { id: string; title: string; description: string | null; location: string | null;
  start_time: Date; end_time: Date; created_at: Date; recurrence: string | null };
type FeedTx = Pick<Prisma.TransactionClient, "family" | "event">;

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// Fold by UTF-8 octets, never UTF-16 code units. Retain the prior conservative
// ASCII widths (74 first-line bytes; 73 plus the continuation space), below 75.
function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 74) return line
  const parts: string[] = []
  let segment = ''
  let bytes = 0
  let width = 74
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > width) {
      parts.push(parts.length ? ' ' + segment : segment)
      segment = ''
      bytes = 0
      width = 73
    }
    segment += character
    bytes += size
  }
  if (segment) parts.push(parts.length ? ' ' + segment : segment)
  return parts.join('\r\n')
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** No successful prefix: build within limits before returning any calendar bytes. */
export async function buildCalendarFeed(tx: FeedTx, token: string, now: Date) {
  const family = await tx.family.findFirst({
    where: { feed_token: token }, select: { id: true, name: true },
  });
  if (!family) return { kind: "unauthorized" as const };
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const to = new Date(now.getTime() + 365 * 86_400_000);
  const chunks: string[] = [];
  let bytes = 0, count = 0;
  const append = (line: string) => {
    bytes += Buffer.byteLength(line, "utf8") + 2;
    if (bytes > CALENDAR_FEED_MAX_BYTES) throw new CalendarFeedTooLarge();
    chunks.push(line + "\r\n");
  };
  const text = (name: string, value: string) => {
    // Avoid folding/escaping arbitrarily large legacy text before the wire budget.
    if (Buffer.byteLength(value, "utf8") > CALENDAR_FEED_MAX_BYTES - bytes)
      throw new CalendarFeedTooLarge();
    append(fold(`${name}:${escapeIcs(value)}`));
  };
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Family Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"].forEach(append);
  text("X-WR-CALNAME", family.name);
  let cursor: { start_time: Date; id: string } | null = null;
  while (true) {
    const take = Math.min(CALENDAR_FEED_PAGE_SIZE, CALENDAR_FEED_MAX_EVENTS - count + 1);
    const events: FeedEvent[] = await tx.event.findMany({
      where: {
        family_id: family.id,
        OR: [{ recurrence: { not: null } }, { start_time: { gte: from, lte: to } }],
        ...(cursor ? { AND: [{ OR: [
          { start_time: { gt: cursor.start_time } },
          { start_time: cursor.start_time, id: { gt: cursor.id } },
        ] }] } : {}),
      },
      select: { id: true, title: true, description: true, location: true,
        start_time: true, end_time: true, created_at: true, recurrence: true },
      orderBy: [{ start_time: "asc" }, { id: "asc" }], take,
    });
    for (const event of events) {
      if (++count > CALENDAR_FEED_MAX_EVENTS) throw new CalendarFeedTooLarge();
      const end = event.end_time && event.end_time > event.start_time ? event.end_time : event.start_time;
      append("BEGIN:VEVENT");
      append(`UID:${event.id}@family.ashbi.ca`);
      append(`DTSTAMP:${stamp(event.created_at)}`);
      append(`DTSTART:${stamp(event.start_time)}`);
      append(`DTEND:${stamp(end)}`);
      text("SUMMARY", event.title);
      if (event.description) text("DESCRIPTION", event.description);
      if (event.location) text("LOCATION", event.location);
      if (event.recurrence !== null) {
        if (Buffer.byteLength(event.recurrence, "utf8") > CALENDAR_FEED_MAX_BYTES - bytes)
          throw new CalendarFeedTooLarge();
        append(fold(`RRULE:${calendarFeedRule(event.recurrence)}`));
      }
      append("END:VEVENT");
    }
    if (events.length < take) break;
    const last = events[events.length - 1];
    cursor = { start_time: last.start_time, id: last.id };
  }
  append("END:VCALENDAR");
  return { kind: "ok" as const, ics: chunks.join("") };
}
