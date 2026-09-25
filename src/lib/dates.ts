import { format } from 'date-fns'

/**
 * Date helpers for date-only values (e.g. meal dates) and month windows.
 *
 * Date-only values are exchanged as `YYYY-MM-DD` strings and stored as UTC
 * midnight of that calendar day. Clients must compare them by the
 * `YYYY-MM-DD` prefix of the returned ISO string, never by parsing into a
 * local-time `Date` (that shifts the day for users west/east of UTC).
 */

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
export const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Parse a strict `YYYY-MM-DD` string to UTC midnight. Returns null if invalid. */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  // Reject overflow like 2026-02-31
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return date
}

/** `YYYY-MM-DD` (UTC calendar day) of a Date or ISO string. */
export function toDateOnlyUTC(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` of a Date in the runtime's local time zone (client-side use). */
export function toDateOnlyLocal(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/**
 * Short calendar label (default "Jan 5") for a date-only value stored as UTC
 * midnight, such as a chore due date. Formats in UTC so viewers west of UTC
 * do not see the previous day.
 */
export function formatDateOnly(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
): string {
  const date = parseDateOnly(toDateOnlyUTC(value))
  if (!date) return ''
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

/** Local calendar day `days` after `now`, as `YYYY-MM-DD` (client-side use). */
function localDateOnlyPlusDays(now: Date, days: number): string {
  const next = new Date(now.getTime())
  next.setDate(next.getDate() + days)
  return toDateOnlyLocal(next)
}

/**
 * Whether a date-only value (UTC midnight) falls on the viewer's local
 * calendar day. Compares the stored UTC date part with the local date string.
 */
export function isDueToday(value: Date | string, now: Date = new Date()): boolean {
  return toDateOnlyUTC(value) === toDateOnlyLocal(now)
}

/** Whether a date-only value falls within the next `days` local calendar days (today inclusive). */
export function isDueWithinDays(value: Date | string, days: number, now: Date = new Date()): boolean {
  const day = toDateOnlyUTC(value)
  return day >= toDateOnlyLocal(now) && day <= localDateOnlyPlusDays(now, days)
}

/** "Today", "Tomorrow" or a short date for a date-only value such as a chore due date. */
export function formatRelativeDueDate(value: Date | string, now: Date = new Date()): string {
  const day = toDateOnlyUTC(value)
  if (day === toDateOnlyLocal(now)) return 'Today'
  if (day === localDateOnlyPlusDays(now, 1)) return 'Tomorrow'
  return formatDateOnly(value)
}

/** Add whole days to a UTC-midnight date. */
export function addUTCDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** UTC midnight of the current UTC day. */
export function startOfTodayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Normalize an API-supplied date-only field (e.g. a chore `due_date`) to UTC
 * midnight. Accepts a strict `YYYY-MM-DD`, or any parseable timestamp, which is
 * truncated to its UTC calendar day. Returns null for anything else.
 */
export function normalizeDateOnlyInput(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  if (DATE_ONLY_RE.test(value)) return parseDateOnly(value)
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) return null
  return startOfTodayUTC(parsed)
}

/**
 * New due day (`YYYY-MM-DD`) when a date-only chore is snoozed: one day after
 * the later of its current due day and the viewer's local today. An overdue or
 * due-today chore moves to tomorrow; a future chore moves back by one day.
 */
export function snoozedDueDate(current: Date | string, now: Date = new Date()): string {
  const currentDay = toDateOnlyUTC(current)
  const today = toDateOnlyLocal(now)
  const base = parseDateOnly(currentDay > today ? currentDay : today)
  // `today` is always a valid date-only string, so base is only null for a malformed `current`.
  return toDateOnlyUTC(addUTCDays(base ?? (parseDateOnly(today) as Date), 1))
}

/** Parse a strict `YYYY-MM` string. Returns null if invalid. */
export function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = YEAR_MONTH_RE.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) }
}

/**
 * UTC window for a calendar month (1-based `month`; out-of-range values roll
 * over, so `month - 5` works for trends). `end` is exclusive.
 */
export function utcMonthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

/**
 * Convert a local `datetime-local`-style value (`YYYY-MM-DDTHH:mm`) to an ISO
 * string with offset, interpreting it in the runtime's local time zone.
 * Returns null if the value can't be parsed.
 */
export function localDateTimeToISO(value: string): string | null {
  const date = new Date(value)
  if (isNaN(date.getTime())) return null
  return date.toISOString()
}
