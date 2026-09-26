// Wall-clock -> instant conversion for imported iCalendar times (#232).
//
// ICS times arrive as local wall-clock values plus a TZID (or "floating", no
// zone at all). We resolve them with the runtime's IANA database via Intl so
// DST transitions are handled the same way the rest of the platform does,
// instead of trusting hand-written VTIMEZONE rules in every feed.

/** Households have no stored time zone yet; this is the product default. */
export const DEFAULT_FAMILY_TIMEZONE = "America/Toronto";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** True when `timeZone` is an IANA zone name the runtime knows. */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instantMs`, in milliseconds (east positive). */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  // formatToParts drops milliseconds; compare against the whole-second instant.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC instant for a wall-clock time in `timeZone`, following RFC 5545 §3.3.5:
 * - an ambiguous time (DST fall-back) is the FIRST occurrence;
 * - a non-existent time (DST spring-forward gap) is interpreted with the UTC
 *   offset in effect before the gap (so 02:30 becomes 03:30 daylight time).
 */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const before = timeZoneOffsetMs(guess - DAY_MS, timeZone);
  const after = timeZoneOffsetMs(guess + DAY_MS, timeZone);

  const candidates = [before, after]
    .map((offset) => guess - offset)
    .filter(
      (instant) => guess - timeZoneOffsetMs(instant, timeZone) === instant,
    );
  if (candidates.length > 0) return new Date(Math.min(...candidates));

  // In the gap: use the offset in effect before the transition.
  return new Date(guess - before);
}
