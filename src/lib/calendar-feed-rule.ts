/** Feed-boundary validation only. Never expands, rewrites storage or repairs a rule. */
import ICAL from "ical.js";
export class CalendarFeedInvalidRule extends Error {
  constructor() { super("Calendar feed contains an unsupported recurrence rule"); }
}
const KEYS = new Set([
  "FREQ", "COUNT", "UNTIL", "INTERVAL", "WKST", "BYSECOND", "BYMINUTE", "BYHOUR",
  "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS",
]);
/**
 * Keep the supplied key order and explicit values. Recur.toString() would drop
 * unknown parts/defaults; parsing alone also normalizes INTERVAL<=0. Reject
 * ambiguous/unsupported structure first. No iterator or occurrence work here.
 */
export function calendarFeedRule(raw: string): string {
  const fail = () => new CalendarFeedInvalidRule();
  if (raw.length > 8192) throw fail();
  const rule = raw.trim().replace(/^RRULE:/i, "").toUpperCase();
  const parts = new Map<string, string>();
  for (const segment of rule.split(";")) {
    const match = /^([A-Z]+)=([A-Z0-9,+-]+)$/.exec(segment);
    if (!match || !KEYS.has(match[1]) || parts.has(match[1])) throw fail();
    parts.set(match[1], match[2]);
  }
  if (!parts.has("FREQ") || (parts.has("COUNT") && parts.has("UNTIL"))) throw fail();
  for (const name of ["COUNT", "INTERVAL"]) {
    const value = parts.get(name);
    if (value !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1))
      throw fail();
  }
  // The parser permits zero for these numeric ranges; zero has no supported
  // day/week/position meaning in this feed contract. Do not silently adopt it.
  for (const name of ["BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYSETPOS"]) {
    const value = parts.get(name);
    if (value !== undefined && value.split(",").some(part => Number(part) === 0)) throw fail();
  }
  try {
    const parsed = ICAL.Recur.fromString(rule);
    if (!parsed.freq || (parts.has("UNTIL") && parsed.until?.toICALString() !== parts.get("UNTIL"))) throw fail();
  } catch {
    // Never propagate library errors containing private stored rule text.
    throw fail();
  }
  return rule;
}
