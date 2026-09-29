/**
 * "Updated just now / 3 min ago" wording for visible sync (#271).
 *
 * Words, never a bare timestamp, so the board and the calendar read the same
 * across the room and to a screen reader. Pure: callers pass `now` (the board
 * re-renders on its own clock tick), which keeps this testable and
 * hydration-safe.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function toTime(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime()
}

/**
 * How long ago `then` was, in words: "just now", "1 min ago", "12 min ago",
 * "1 hour ago", "5 hours ago", "yesterday", "3 days ago". A `then` in the
 * future (a small clock difference) reads as "just now". An invalid date reads
 * as "a while ago" rather than "NaN min ago".
 */
export function formatRelativeTime(then: Date | string | number, now: Date | number): string {
  const t = toTime(then)
  const n = typeof now === 'number' ? now : now.getTime()
  if (!Number.isFinite(t) || !Number.isFinite(n)) return 'a while ago'
  const age = n - t
  if (age < MINUTE) return 'just now'
  if (age < HOUR) {
    const m = Math.floor(age / MINUTE)
    return `${m} min ago`
  }
  if (age < DAY) {
    const h = Math.floor(age / HOUR)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const d = Math.floor(age / DAY)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** "Updated just now", "Updated 3 min ago". */
export function updatedAgo(then: Date | string | number, now: Date | number): string {
  return `Updated ${formatRelativeTime(then, now)}`
}
