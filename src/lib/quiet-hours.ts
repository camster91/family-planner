// Per-member quiet hours (#141, restrained reminders; decision O-32).
//
// Pure and client-safe: the preferences route, the delivery helper
// (src/lib/notification-delivery.ts), the Settings UI and the tests all use it.
//
// What quiet hours do: during the window, in-app notifications are still
// stored (nothing is lost; the bell list shows them as usual), but
// deliverNotification reports `quiet: true`, and any interruptive channel
// (push, a sound, a toast, a reminder email) must hold it. Today the app has no
// such channel: notifications are in-app rows only, read when the person opens
// the notifications page, and the only email is account mail, which is always
// sent. So quiet hours are a stored preference that every future interruptive
// sender must honour through `isInQuietHours`.
//
// "Local" time: dates on the client use the browser's local time (O-31; there
// is no per-household time zone yet). The window is entered in the browser, so
// the browser's IANA time zone is saved with it and the server reads the wall
// clock in that zone. A row without a zone (or with one this runtime does not
// know) is read in UTC, the server's clock.

import { clockMinutes, isClockTime } from '@/lib/ambient'

export interface QuietHours {
  enabled: boolean
  /** "HH:MM", 24-hour, inclusive. */
  start: string
  /** "HH:MM", 24-hour, exclusive. May be earlier than `start` (wraps past midnight). */
  end: string
  /** IANA zone the times are in (the browser's when saved), or null for UTC. */
  timeZone: string | null
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: '22:00', end: '07:00', timeZone: null }

/** Longest IANA zone name we store (the longest real one is about 30 characters). */
export const MAX_TIME_ZONE_LENGTH = 64

/** Prisma `select` for the quiet-hours columns on User. */
export const QUIET_HOURS_SELECT = {
  quiet_hours_enabled: true,
  quiet_hours_start: true,
  quiet_hours_end: true,
  quiet_hours_time_zone: true,
} as const

type QuietHoursRow = {
  quiet_hours_enabled?: boolean | null
  quiet_hours_start?: string | null
  quiet_hours_end?: string | null
  quiet_hours_time_zone?: string | null
}

/** Whether this runtime knows `value` as an IANA time zone. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * Row -> API shape. Only an explicit `true` turns quiet hours on (the column
 * defaults to false); malformed times fall back to the defaults.
 */
export function quietHoursFromRow(row: QuietHoursRow | null | undefined): QuietHours {
  return {
    enabled: row?.quiet_hours_enabled === true,
    start: isClockTime(row?.quiet_hours_start) ? row!.quiet_hours_start! : DEFAULT_QUIET_HOURS.start,
    end: isClockTime(row?.quiet_hours_end) ? row!.quiet_hours_end! : DEFAULT_QUIET_HOURS.end,
    timeZone: isValidTimeZone(row?.quiet_hours_time_zone) ? row!.quiet_hours_time_zone! : null,
  }
}

/** API shape -> the User columns to write. */
export function quietHoursToColumns(q: QuietHours) {
  return {
    quiet_hours_enabled: q.enabled,
    quiet_hours_start: q.start,
    quiet_hours_end: q.end,
    quiet_hours_time_zone: q.timeZone,
  }
}

/**
 * Minutes after local midnight in `timeZone` (UTC when null or unknown).
 * Uses the zone's real offset at that instant, so daylight-saving changes are
 * applied: on a spring-forward night the skipped hour never appears, and on a
 * fall-back night the repeated hour appears twice.
 */
export function localMinutes(now: Date, timeZone: string | null | undefined): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/**
 * Whether `minutes` (after local midnight) falls in the window `start`..`end`.
 * Start inclusive, end exclusive. A window whose end is earlier than its start
 * ("22:00" to "07:00") wraps past midnight. Equal or malformed times are an
 * empty window.
 */
export function isWithinWindow(minutes: number, start: string, end: string): boolean {
  const s = clockMinutes(start)
  const e = clockMinutes(end)
  if (s === null || e === null || s === e) return false
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}

/** Plain-words problem with the two times (Settings form), or null when they can be saved. */
export function quietHoursProblem(start: string, end: string): string | null {
  if (!isClockTime(start) || !isClockTime(end)) return 'Choose both a start and an end time.'
  if (start === end) return 'The start and end times must be different.'
  return null
}

/** Whether `now` is inside the member's quiet hours. Off unless enabled. */
export function isInQuietHours(now: Date, quiet: QuietHours | null | undefined): boolean {
  if (!quiet?.enabled) return false
  return isWithinWindow(localMinutes(now, quiet.timeZone), quiet.start, quiet.end)
}
