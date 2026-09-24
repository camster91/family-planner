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
