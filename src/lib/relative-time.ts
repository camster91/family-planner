/**
 * "Updated just now / 3 min ago" wording for visible sync (#271).
 *
 * Words, never a bare timestamp, so the board and the calendar read the same
 * across the room and to a screen reader. Pure: callers pass `now` (the board
 * re-renders on its own clock tick), which keeps this testable and
 * hydration-safe.
 */

export interface RelativeTimeMessages {
  justNow: string;
  invalid: string;
  minutes: (count: number) => string;
  hours: (count: number) => string;
  yesterday: string;
  days: (count: number) => string;
}
export const ENGLISH_RELATIVE_TIME: RelativeTimeMessages = {
  justNow: "just now",
  invalid: "a while ago",
  minutes: (n) => `${n} min ago`,
  hours: (n) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
  yesterday: "yesterday",
  days: (n) => `${n} days ago`,
};
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toTime(value: Date | string | number): number {
  return value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : new Date(value).getTime();
}

/**
 * How long ago `then` was, in words: "just now", "1 min ago", "12 min ago",
 * "1 hour ago", "5 hours ago", "yesterday", "3 days ago". A `then` in the
 * future (a small clock difference) reads as "just now". An invalid date reads
 * as "a while ago" rather than "NaN min ago".
 */
export function formatRelativeTime(
  then: Date | string | number,
  now: Date | number,
  messages: RelativeTimeMessages = ENGLISH_RELATIVE_TIME,
): string {
  const t = toTime(then);
  const n = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return messages.invalid;
  const age = n - t;
  if (age < MINUTE) return messages.justNow;
  if (age < HOUR) {
    const m = Math.floor(age / MINUTE);
    return messages.minutes(m);
  }
  if (age < DAY) {
    const h = Math.floor(age / HOUR);
    return messages.hours(h);
  }
  const d = Math.floor(age / DAY);
  return d === 1 ? messages.yesterday : messages.days(d);
}

/** "Updated just now", "Updated 3 min ago". */
export function updatedAgo(
  then: Date | string | number,
  now: Date | number,
): string {
  return `Updated ${formatRelativeTime(then, now)}`;
}
