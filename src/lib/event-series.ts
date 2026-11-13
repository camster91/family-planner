/**
 * Repeating events (#124 follow-up). Shared, storage-neutral rules.
 *
 * A repeating event is an EventSeries plus one ordinary Event row per
 * occurrence. Occurrences are real rows so everything that already works on
 * an event (people, preparation, conflict review, the Today board, the feed)
 * works on every repeat without knowing about series. Rows are written ahead
 * of time and topped up when the calendar or Today board is read: never by a
 * scheduler (AGENTS.md; the same rule as chore series, O-33).
 *
 * The repeat is a small closed set, not an RRULE: every day, every week,
 * every two weeks, every month, every year, with an optional last day.
 * Occurrences keep their wall-clock time in the series time zone, so a 9:00
 * event stays at 9:00 across a daylight-saving change.
 *
 * Default-off: FAMILY_EVENT_REPEAT_READY. Off, a `repeat` request is refused
 * before any write and no reader tops anything up.
 */
import { isValidTimeZone, timeZoneOffsetMs, zonedWallTimeToUtc, type WallTime } from './calendar-import/timezone'

export const EVENT_REPEAT_READY_ENV = 'FAMILY_EVENT_REPEAT_READY'
export const eventRepeatReady = () => process.env[EVENT_REPEAT_READY_ENV] === '1'

export const EVENT_REPEAT_UNSUPPORTED_CODE = 'EVENT_REPEAT_UNSUPPORTED'
export const EVENT_REPEAT_INVALID_CODE = 'EVENT_REPEAT_INVALID'
export const EVENT_REPEAT_UNSUPPORTED = {
  status: 409,
  body: { error: 'Repeating events are not available on this server.', code: EVENT_REPEAT_UNSUPPORTED_CODE },
} as const
export const EVENT_REPEAT_INVALID = {
  status: 400,
  body: { error: 'Choose how often the event repeats and a last day on or after it starts.', code: EVENT_REPEAT_INVALID_CODE },
} as const
export const EVENT_SERIES_SCOPE_CODE = 'EVENT_SERIES_SCOPE_INVALID'

export const EVENT_REPEAT_EVERY = ['day', 'week', '2weeks', 'month', 'year'] as const
export type EventRepeatEvery = (typeof EVENT_REPEAT_EVERY)[number]
/** What a client sends. `until` is the last local day (inclusive), YYYY-MM-DD. */
export type EventRepeatInput = { every: EventRepeatEvery; until?: string | null; time_zone: string }
export type EventSeriesScope = 'this' | 'following'

/** How far ahead rows exist after any top-up, and the hard bounds on one. */
export const SERIES_HORIZON_MS = 120 * 86_400_000
export const SERIES_MAX_AHEAD_MS = 731 * 86_400_000
export const SERIES_TOP_UP_MAX = 400

export type SeriesRule = {
  every: EventRepeatEvery
  /** IANA zone the wall-clock time is kept in. */
  timeZone: string
  /** First occurrence start, epoch ms. */
  anchorStart: number
  /** Last local day (inclusive) as YYYY-MM-DD, or null for no end. */
  untilDay: string | null
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
export function isLocalDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DAY.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return y >= 1970 && y <= 2200 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Wall-clock parts of an instant in a zone. */
export function wallTimeIn(instantMs: number, timeZone: string): WallTime {
  const local = new Date(instantMs + timeZoneOffsetMs(instantMs, timeZone))
  return {
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
  }
}
const dayKey = (wall: Pick<WallTime, 'year' | 'month' | 'day'>) =>
  `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
export const localDayIn = (instantMs: number, timeZone: string) => dayKey(wallTimeIn(instantMs, timeZone))

/** The wall-clock time of occurrence `index`, or null when that calendar date does not exist. */
function occurrenceWall(anchor: WallTime, every: EventRepeatEvery, index: number): WallTime | null {
  if (every === 'day' || every === 'week' || every === '2weeks') {
    const step = every === 'day' ? 1 : every === 'week' ? 7 : 14
    const date = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + step * index))
    return { ...anchor, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
  }
  const months = every === 'month' ? index : 12 * index
  const total = anchor.year * 12 + (anchor.month - 1) + months
  const year = Math.floor(total / 12), month = (total % 12) + 1
  // "Monthly on the 31st" and "yearly on Feb 29" skip months and years
  // without that day, the same as the iCalendar rule would.
  const date = new Date(Date.UTC(year, month - 1, anchor.day))
  if (date.getUTCMonth() !== month - 1) return null
  return { ...anchor, year, month }
}

/** A request's repeat as a stored rule, or null when it is not valid for this start. */
export function seriesRuleFor(input: EventRepeatInput, anchorStart: number): SeriesRule | null {
  if (!EVENT_REPEAT_EVERY.includes(input.every) || !isValidTimeZone(input.time_zone) || !Number.isFinite(anchorStart)) return null
  const until = input.until ?? null
  if (until !== null && (!isLocalDay(until) || until < localDayIn(anchorStart, input.time_zone))) return null
  return { every: input.every, timeZone: input.time_zone, anchorStart, untilDay: until }
}

/**
 * Occurrence starts strictly after `afterMs` and no later than `throughMs`,
 * in order, at most `max`. `done` is true when the series has no occurrence
 * left after the returned ones (its last day has passed).
 */
export function seriesOccurrences(rule: SeriesRule, afterMs: number, throughMs: number, max = SERIES_TOP_UP_MAX): { starts: number[]; done: boolean } {
  const anchor = wallTimeIn(rule.anchorStart, rule.timeZone)
  const starts: number[] = []
  // Bounded walk from the anchor: at most ~200 years of daily steps.
  for (let index = 0; index < 80_000; index++) {
    const wall = occurrenceWall(anchor, rule.every, index)
    if (!wall) continue
    if (rule.untilDay !== null && dayKey(wall) > rule.untilDay) return { starts, done: true }
    // Index 0 is the anchor instant itself, exactly as stored.
    const start = index === 0 ? rule.anchorStart : zonedWallTimeToUtc(wall, rule.timeZone).getTime()
    if (start > throughMs) return { starts, done: false }
    if (start <= afterMs) continue
    if (starts.length >= max) return { starts, done: false }
    starts.push(start)
  }
  return { starts, done: true }
}

/** Stable id of an occurrence row: the same occurrence is never written twice. */
export const seriesEventId = (seriesId: string, startMs: number) => `${seriesId}_${Math.trunc(startMs / 1000).toString(36)}`

/** How far a top-up should reach for a reader looking up to `wantedMs`. */
export function seriesTopUpTarget(nowMs: number, wantedMs?: number): number {
  return Math.min(nowMs + SERIES_MAX_AHEAD_MS, Math.max(nowMs + SERIES_HORIZON_MS, wantedMs ?? 0))
}

/** The local day before a local day. */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d - 1))
  return dayKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
}

export type FollowingBase = {
  /** The occurrence being edited, as stored now. */
  event: { start: number; end: number; title: string; description: string | null; location: string | null; event_type: string; occurrenceStart: number }
  /** Its series, as stored now. Null for a one-off event that starts repeating here. */
  series: { every: EventRepeatEvery; timeZone: string; untilDay: string | null; anchorStart: number } | null
}
export type FollowingInput = {
  title?: string; description?: string | null; location?: string | null; event_type?: string
  start_time?: string; end_time?: string; repeat?: EventRepeatInput | null
}
export type FollowingPlan = {
  start: number; end: number
  template: { title: string; description: string | null; location: string | null; event_type: string }
  /** The repeat from this event on, or null to stop repeating here. */
  rule: SeriesRule | null
  /** What happens to the series this event came from. */
  previous: { kind: 'none' } | { kind: 'remove' } | { kind: 'end'; untilDay: string }
}
type Refusal = { status: number; body: { error: string; code?: string } }

/**
 * "This and later events": the edited occurrence starts a new series (or
 * becomes a one-off) and the series it came from ends the day before it.
 * Earlier occurrences are never touched. Shared by both stores so the
 * decision is made once; each store applies it atomically.
 */
export function planFollowingEdit(base: FollowingBase, input: FollowingInput): FollowingPlan | Refusal {
  const start = input.start_time === undefined ? base.event.start : new Date(input.start_time).getTime()
  // A moved start keeps the event's length unless an end is given too.
  const end = input.end_time !== undefined ? new Date(input.end_time).getTime()
    : input.start_time !== undefined ? start + (base.event.end - base.event.start) : base.event.end
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { status: 400, body: { error: 'Invalid start or end time' } }
  if (end < start) return { status: 400, body: { error: 'End time must be after start time' } }
  const series = base.series
  let rule: SeriesRule | null
  if (input.repeat === null) rule = null
  else {
    // A one-off event has no repeat to keep: it needs one to start repeating.
    const repeat = input.repeat ?? (series ? { every: series.every, time_zone: series.timeZone, until: series.untilDay } : null)
    if (!repeat) return EVENT_NOT_REPEATING
    rule = seriesRuleFor(repeat, start)
    if (!rule) return EVENT_REPEAT_INVALID
  }
  if (!series && !rule) return EVENT_NOT_REPEATING
  return {
    start, end, rule,
    template: {
      title: input.title ?? base.event.title,
      description: input.description !== undefined ? input.description : base.event.description,
      location: input.location !== undefined ? input.location : base.event.location,
      event_type: input.event_type ?? base.event.event_type,
    },
    previous: !series ? { kind: 'none' } : base.event.occurrenceStart === series.anchorStart ? { kind: 'remove' }
      : { kind: 'end', untilDay: dayBefore(localDayIn(base.event.occurrenceStart, series.timeZone)) },
  }
}
export const isFollowingRefusal = (plan: FollowingPlan | Refusal): plan is Refusal => 'status' in plan
export const EVENT_NOT_REPEATING = { status: 409, body: { error: 'This event does not repeat.', code: EVENT_SERIES_SCOPE_CODE } } as const
