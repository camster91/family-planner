/**
 * All-day events (UI review item 9). Shared, storage-neutral rules.
 *
 * `Event.all_day` marks an event with no time of day. Its instants stay real
 * so every reader that only knows start and end keeps working:
 *
 * - made in the app: 00:00 of the first day to 23:59 of the last day, in the
 *   zone it was made in (the convention the event form, event import and
 *   project tasks already used for date-only entries);
 * - imported from a feed (DATE values): midnight of the first day to midnight
 *   after the last day, in the household zone.
 *
 * Readers never show those times. They ask `allDayDays` for the calendar days
 * instead, which works for both shapes and needs no time zone: the start is a
 * local midnight, so the zone's offset can be read back from it. That holds
 * for offsets from UTC-10:15 to UTC+13:45 (every inhabited zone except the
 * Line Islands and American Samoa, which land one day off).
 */
const HOUR = 3_600_000
const DAY = 24 * HOUR
const SHIFT = 13.75 * HOUR

export type AllDayDays = { first: string; last: string }

const ms = (value: Date | string | number): number =>
  typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
const dayKey = (instant: number) => new Date(instant).toISOString().slice(0, 10)

/** The first and last calendar day (YYYY-MM-DD, inclusive) of an all-day event. */
export function allDayDays(start: Date | string | number, end: Date | string | number): AllDayDays | null {
  const from = ms(start), until = ms(end)
  if (!Number.isFinite(from) || Math.abs(from) > 8.6e15 - 2 * DAY) return null
  const midnight = Math.floor((from + SHIFT) / DAY) * DAY
  const first = dayKey(midnight)
  if (!Number.isFinite(until) || Math.abs(until) > 8.6e15 - 2 * DAY) return { first, last: first }
  // One hour of slack covers a clock change inside a longer event, and the
  // millisecond turns "midnight after the last day" back into the last day.
  const last = dayKey(Math.max(midnight, until + (midnight - from) - HOUR - 1))
  return { first, last }
}

/** True when an all-day event is on the given calendar day. */
export function allDayCovers(event: { start: Date | string | number; end: Date | string | number }, day: string): boolean {
  const days = allDayDays(event.start, event.end)
  return days !== null && days.first <= day && day <= days.last
}

/** The calendar day after a YYYY-MM-DD day. */
export function dayAfter(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayKey(Date.UTC(y, m - 1, d + 1))
}

/** How many calendar days an all-day event covers (at least 1). */
export function allDayLength(days: AllDayDays): number {
  return Math.max(1, Math.round((Date.parse(`${days.last}T00:00:00Z`) - Date.parse(`${days.first}T00:00:00Z`)) / DAY) + 1)
}

/** A request that says "all day" must cover some time: a first and a last day. */
export const ALL_DAY_INVALID = {
  status: 400,
  body: { error: 'An all-day event needs a start day and an end on or after it.', code: 'EVENT_ALL_DAY_INVALID' },
} as const
export function validAllDayRange(startMs: number, endMs: number): boolean {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
}
