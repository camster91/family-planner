/**
 * Pure view-model helpers for the Today board (#119 / #159).
 *
 * The server sends a zone-agnostic window (see
 * src/app/dashboard/today/today-board-data.ts); these helpers pick "today" and
 * the next days against the viewer's LOCAL calendar. Date-only values (chore
 * due days, meal days) are compared by their `YYYY-MM-DD` string, never parsed
 * into a local Date (src/lib/dates.ts).
 */
import { parseDateOnly, toDateOnlyLocal } from '@/lib/dates'
import type {
  BoardChore,
  BoardDinner,
  BoardEvent,
  BoardMember,
  BoardUseSoonItem,
} from '@/app/dashboard/today/today-board-data'
import { DEFAULT_USE_SOON_DAYS, expiryLabel, expiryStatus, isUseSoonStatus } from '@/lib/inventory'
import type { BoardWeather } from '@/lib/weather/board-weather'
import { MEMBER_COLOR_KEYS, type MemberColorKey } from '@/lib/member-colors'

export const DONE_CHORE_STATUSES = ['completed', 'verified'] as const

export function isChoreDone(status: string): boolean {
  return (DONE_CHORE_STATUSES as readonly string[]).includes(status)
}

/** Local `YYYY-MM-DD` for `days` after `now`'s local calendar day. */
export function localDayKey(now: Date, days = 0): string {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() + days)
  return toDateOnlyLocal(d)
}

export interface TodayEvent extends BoardEvent {
  /** Started before now and not finished yet. */
  happeningNow: boolean
  /** Started on an earlier day (multi-day event still running today). */
  startedEarlier: boolean
}

/**
 * Events still to come (or in progress) on the viewer's local today, soonest
 * first. A multi-day event that began on an earlier day and is still running
 * is included and flagged `startedEarlier`.
 */
export function eventsLeftToday(events: BoardEvent[], now: Date): TodayEvent[] {
  const today = localDayKey(now)
  const t = now.getTime()
  return events
    .filter((e) => new Date(e.end).getTime() > t)
    .filter((e) => toDateOnlyLocal(new Date(e.start)) <= today)
    .map((e) => ({
      ...e,
      happeningNow: new Date(e.start).getTime() <= t,
      startedEarlier: toDateOnlyLocal(new Date(e.start)) < today,
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}

/** Events that start on the given local day. */
export function eventsStartingOn(events: BoardEvent[], dayKey: string): BoardEvent[] {
  return events
    .filter((e) => toDateOnlyLocal(new Date(e.start)) === dayKey)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}

/** The dinner planned for a local day, if any (first one wins). */
export function dinnerOn(dinners: BoardDinner[] | null, dayKey: string): BoardDinner | null {
  return dinners?.find((d) => d.day === dayKey) ?? null
}

export interface PersonChores {
  member: BoardMember
  open: BoardChore[]
  /** Completed or checked today. */
  doneCount: number
  /** Of those, marked done but not yet checked by a parent (status `completed`). */
  awaitingCheckCount: number
}

/**
 * Chores due on the viewer's local today, grouped by person in household
 * order. People with nothing due today are omitted. No points, XP or streaks:
 * the board is a calm shared surface (BRAND.md).
 */
export function choresDueTodayByPerson(chores: BoardChore[], members: BoardMember[], now: Date): PersonChores[] {
  const today = localDayKey(now)
  const due = chores.filter((c) => c.dueDay === today)
  return members
    .map((member) => {
      const mine = due.filter((c) => c.assigneeId === member.id)
      return {
        member,
        open: mine.filter((c) => !isChoreDone(c.status)),
        doneCount: mine.filter((c) => isChoreDone(c.status)).length,
        awaitingCheckCount: mine.filter((c) => c.status === 'completed').length,
      }
    })
    .filter((p) => p.open.length > 0 || p.doneCount > 0)
}

export interface ComingUpDay {
  dayKey: string
  /** "Tomorrow", then weekday names. */
  label: string
  /** Short calendar date, e.g. "Jan 6". */
  dateLabel: string
  events: BoardEvent[]
  dinner: BoardDinner | null
}

/** The next `days` local days after today. */
export function comingUp(
  events: BoardEvent[],
  dinners: BoardDinner[] | null,
  now: Date,
  days: number
): ComingUpDay[] {
  const out: ComingUpDay[] = []
  for (let i = 1; i <= days; i++) {
    const d = new Date(now.getTime())
    d.setDate(d.getDate() + i)
    const dayKey = toDateOnlyLocal(d)
    out.push({
      dayKey,
      label: i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }),
      dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      events: eventsStartingOn(events, dayKey),
      dinner: dinnerOn(dinners, dayKey),
    })
  }
  return out
}

/** "9:00 AM" in the viewer's zone. */
export function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Monday, January 5" in the viewer's zone. */
export function formatLongDate(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

/** First word of a display name, for compact labels ("Avery Fixture-A" -> "Avery"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/**
 * Member colour by id (#262). Members from a server built before #262 carry
 * no colour; they get the palette in household order so the board still
 * reads consistently.
 */
export function memberColors(members: BoardMember[]): Map<string, MemberColorKey> {
  return new Map(members.map((m, i) => [m.id, m.color ?? MEMBER_COLOR_KEYS[i % MEMBER_COLOR_KEYS.length]]))
}

/** The weather place's current calendar date: now shifted by its UTC offset. */
export function placeDayKey(now: Date, utcOffsetSeconds: number): string {
  return new Date(now.getTime() + utcOffsetSeconds * 1000).toISOString().slice(0, 10)
}

export interface WeatherView {
  weather: BoardWeather
  /**
   * The forecast day matching the PLACE's current date (its UTC offset from
   * Open-Meteo), else the nearest earlier/first day. Falls back to the
   * viewer's local day when the offset is missing (older server).
   */
  today: BoardWeather['days'][number] | null
  /** Up to three days after `today`. */
  next: BoardWeather['days']
}

/**
 * Picks today's forecast and the next days by the weather place's calendar
 * (forecast days are place-local dates), so a place across the date line or
 * in another zone never shows yesterday's or tomorrow's row as "today".
 */
export function weatherView(weather: BoardWeather | null | undefined, now: Date): WeatherView | null {
  if (!weather || weather.days.length === 0) return null
  const key =
    typeof weather.utcOffsetSeconds === 'number' ? placeDayKey(now, weather.utcOffsetSeconds) : localDayKey(now)
  let index = weather.days.findIndex((d) => d.day === key)
  if (index < 0) {
    // Forecast from before local midnight: the last day not after today.
    const later = weather.days.findIndex((d) => d.day > key)
    index = later < 0 ? weather.days.length - 1 : Math.max(0, later - 1)
  }
  return {
    weather,
    today: weather.days[index] ?? null,
    next: weather.days.slice(index + 1, index + 4),
  }
}

/** "Tue" for a `YYYY-MM-DD` forecast day (a calendar date, not an instant). */
export function shortWeekday(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

/** First names, unless two members share one (then full names). */
export function memberDisplayNames(members: BoardMember[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const m of members) counts.set(firstName(m.name), (counts.get(firstName(m.name)) ?? 0) + 1)
  return new Map(members.map((m) => [m.id, (counts.get(firstName(m.name)) ?? 0) > 1 ? m.name : firstName(m.name)]))
}

export interface UseSoonEntry extends BoardUseSoonItem {
  /** `expired` is a passed best-before day; a passed use-by day never appears. */
  status: 'expired' | 'today' | 'soon'
  daysLeft: number
  /** "Best before was yesterday", "Use by today", "Best before in 2 days" (text carries the state). */
  label: string
}

/**
 * Items to use soon against the viewer's LOCAL today (#263 data, #262 tile):
 * a passed best-before day, due today, or due within DEFAULT_USE_SOON_DAYS.
 * A passed use-by day is "don't eat", never "use soon" (#158), so it is
 * dropped. The server sends a window wide enough for any zone; rows not yet
 * due (or already past use-by) for this viewer are dropped here.
 */
export function itemsToUseSoon(items: BoardUseSoonItem[] | null | undefined, now: Date): UseSoonEntry[] {
  if (!items || items.length === 0) return []
  const today = parseDateOnly(localDayKey(now))
  if (!today) return []
  return items
    .flatMap((item) => {
      const kind = item.dateKind ?? 'best_before'
      const { status, daysLeft } = expiryStatus(item.expiresOn, today, DEFAULT_USE_SOON_DAYS, kind)
      if (daysLeft === null || !isUseSoonStatus(status)) return []
      return [{ ...item, status, daysLeft, label: expiryLabel(status, daysLeft, kind) }]
    })
    .sort(
      (a, b) =>
        a.expiresOn.localeCompare(b.expiresOn) ||
        useByFirst(a.dateKind) - useByFirst(b.dateKind) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    )
}

export interface NextEventView {
  title: string
  /** "7:30 PM" today, "Tomorrow 9:00 AM", or "Wed 9:00 AM". */
  when: string
}

/**
 * The next event to start (calm display, #271): the soonest event that has
 * not started yet, title and time only (no source, member, place or notes).
 */
export function nextEvent(events: BoardEvent[], now: Date): NextEventView | null {
  const t = now.getTime()
  const next = events
    .filter((e) => new Date(e.start).getTime() > t)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))[0]
  if (!next) return null
  const start = new Date(next.start)
  const day = toDateOnlyLocal(start)
  const time = formatTime(start)
  let when = time
  if (day === localDayKey(now, 1)) when = `Tomorrow ${time}`
  else if (day !== localDayKey(now)) when = `${start.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  return { title: next.title, when }
}

/** Tonight's dinner title for the calm display (as the Dinner region names it), or null. */
export function dinnerTitle(dinner: BoardDinner | null): string | null {
  if (!dinner) return null
  return dinner.recipeName?.trim() || dinner.recipeTitle?.trim() || 'Dinner is planned'
}

/** Same day: a use-by item (safety) before a best-before one (quality). */
const useByFirst = (kind: string | undefined) => (kind === 'use_by' ? 0 : 1)
