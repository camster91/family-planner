// Calendar-day keys in the viewer's local time (O-31: the client is local
// time, the server is UTC). A route that groups instants by day takes the
// client's zone as `tz` (IANA name, preferred) or `tzOffset` (minutes, the
// value of JavaScript's `Date#getTimezoneOffset()`: positive west of UTC) and
// builds a `dayKey` function from it. Without either it keeps UTC days, the
// behaviour older clients already get.

import { isValidTimeZone } from '@/lib/quiet-hours'

const DAY_MS = 24 * 60 * 60 * 1000
/** getTimezoneOffset() range: UTC-14:00 (-840) to UTC+12:00 (720), with slack. */
const MAX_OFFSET_MINUTES = 16 * 60

export type DayKeyFn = (instant: Date) => string

export type LocalZone = { kind: 'utc' } | { kind: 'tz'; timeZone: string } | { kind: 'offset'; minutes: number }

/**
 * Read `tz` / `tzOffset` from query params. Returns `null` when a value was
 * given but is not valid, so the caller can answer 400 instead of silently
 * counting UTC days.
 */
export function parseLocalZone(params: URLSearchParams): LocalZone | null {
  const tz = params.get('tz')
  if (tz !== null && tz !== '') {
    return isValidTimeZone(tz) ? { kind: 'tz', timeZone: tz } : null
  }
  const offset = params.get('tzOffset')
  if (offset !== null && offset !== '') {
    if (!/^-?\d{1,4}$/.test(offset)) return null
    const minutes = Number(offset)
    if (Math.abs(minutes) > MAX_OFFSET_MINUTES) return null
    return { kind: 'offset', minutes }
  }
  return { kind: 'utc' }
}

/** `YYYY-MM-DD` of `instant` in the given zone. */
export function dayKeyFor(zone: LocalZone): DayKeyFn {
  if (zone.kind === 'utc') return (d) => d.toISOString().slice(0, 10)
  if (zone.kind === 'offset') return (d) => new Date(d.getTime() - zone.minutes * 60_000).toISOString().slice(0, 10)
  // en-CA formats a date as YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return (d) => fmt.format(d)
}

/** The day key `days` calendar days after `key` (negative for before). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

/** English weekday name of a day key, e.g. `Monday` (or `Mon` when short). */
export function weekdayOfKey(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' })
}
