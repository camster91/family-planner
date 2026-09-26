/**
 * Pure view-model helpers for the Today board (#119 / #159).
 *
 * The server sends a zone-agnostic window (see
 * src/app/dashboard/today/today-board-data.ts); these helpers pick "today" and
 * the next days against the viewer's LOCAL calendar. Date-only values (chore
 * due days, meal days) are compared by their `YYYY-MM-DD` string, never parsed
 * into a local Date (src/lib/dates.ts).
 */
import { toDateOnlyLocal } from '@/lib/dates'
import type { BoardChore, BoardDinner, BoardEvent, BoardMember } from '@/app/dashboard/today/today-board-data'

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
  doneCount: number
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
