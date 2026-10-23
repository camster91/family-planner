// Browser-safe instant validation shared by planning reads and reviewed drafts.
export class CalendarRangeError extends Error {}
export const CALENDAR_RANGE_MAX_MS = 45 * 24 * 60 * 60 * 1000;
export const CALENDAR_RANGE_MAX_LIMIT = 200;

/** Strict millisecond-precision ISO instant; reject Date's rollover repairs. */
export function parseCalendarInstant(value: string | null): Date {
  const match = value?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) throw new CalendarRangeError("Invalid calendar instant");
  const [, y, mo, d, h, mi, s, , zone] = match;
  const year = Number(y),
    month = Number(mo),
    day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(s) > 59 ||
    (zone !== "Z" &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  ) {
    throw new CalendarRangeError("Invalid calendar instant");
  }
  const date = new Date(value!);
  // Offset conversion can cross the supported UTC year boundaries.
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new CalendarRangeError("Invalid calendar instant");
  }
  return date;
}
