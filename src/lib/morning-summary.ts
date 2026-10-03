// Morning summary (decision O-38): one short daily message per person, e.g.
// "Today: 2 chores (Feed the cat, Make bed), Dentist at 3pm, Tacos for dinner."
//
// Pure and side-effect free: the sender (src/lib/morning-summary-server.ts)
// loads the household's rows once and calls `buildMorningSummary` per person.
//
// Content rules (ROLE_AND_ISOLATION_MATRIX.md "Morning summary"):
//   * Chores: only the person's OWN open chores due on their local today
//     (count, up to 3 titles). Never a sibling's. Needs the `chores` feature.
//   * Events: household events on their local today (first 3 with times, then
//     "and N more"). Every role reads events (title and times only; never the
//     location or description). Needs the `calendar` feature.
//   * Dinner: tonight's planned dinner name. Every role reads meals. Needs the
//     `meals` feature.
//   * Parents only: "N chores to check" (chores waiting for a parent's check,
//     the same count the home summary shows). Teens and children never get it.
//   * Empty parts are left out. Nothing at all -> null: send nothing.
// Calm by design (BRAND.md): no points, streaks, overdue piles or shaming.
//
// Dates (O-31): chores and meals are date-only values (UTC midnight of the
// calendar day, src/lib/dates.ts), compared by their `YYYY-MM-DD`. Events are
// instants, placed on the person's local day in `timeZone`.

import { dayKeyFor } from '@/lib/local-day-key'
import { isOpenStatus } from '@/lib/home-summary'
import { localMinutes } from '@/lib/quiet-hours'

/** Most chore titles and events named in one summary. */
export const MAX_NAMED_CHORES = 3
export const MAX_NAMED_EVENTS = 3
/** Longest title kept (characters); longer ones end in "…". */
export const MAX_TITLE_LENGTH = 60
/** Longest one-line message (the in-app notification body). */
export const MAX_SUMMARY_TEXT = 500

export interface SummaryChore {
  title: string
  /** `YYYY-MM-DD`: UTC calendar day of the stored date-only due date. */
  dueDay: string
  status: string
  assigneeId: string
}

export interface SummaryEvent {
  title: string
  start: Date
  end: Date
}

export interface SummaryDinner {
  /** `YYYY-MM-DD`: UTC calendar day of the stored date-only meal date. */
  day: string
  /** The meal's recipe name, else its linked recipe title. */
  name: string | null
}

export interface SummaryFeatures {
  chores: boolean
  calendar: boolean
  meals: boolean
}

export interface MorningSummaryInput {
  person: { id: string; role: string }
  /** The person's local `YYYY-MM-DD`. */
  dayKey: string
  /** IANA zone the person's day and event times are read in. */
  timeZone: string
  features: SummaryFeatures
  /** Household chores around today (any assignee; filtered here). */
  chores: readonly SummaryChore[]
  events: readonly SummaryEvent[]
  dinners: readonly SummaryDinner[]
  /** Household chores waiting for a parent's check (shown to parents only). */
  toCheckCount: number
}

export interface MorningSummaryEvent {
  title: string
  /** "at 3pm", "until 10am" or "all day". */
  when: string
}

export interface MorningSummary {
  dayKey: string
  /** e.g. "Saturday, October 3". */
  dayLabel: string
  chores: { count: number; titles: string[] } | null
  events: { items: MorningSummaryEvent[]; more: number } | null
  dinner: string | null
  toCheck: number | null
  /** One line for the in-app notification: "Today: …." */
  text: string
  /** One plain line per part, for the email body. */
  lines: string[]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Collapse whitespace and cap the length of user text. */
export function cleanTitle(value: string | null | undefined): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= MAX_TITLE_LENGTH) return text
  return `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

/** "3pm" or "3:30pm" in `timeZone`. */
export function formatClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase().replace(/\./g, '')
  return `${hour}${minute === '00' ? '' : `:${minute}`}${period}`
}

/** "Saturday, October 3" for a `YYYY-MM-DD` key. */
export function dayLabelOf(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Events on the person's local day, soonest first, with a plain "when".
 * An event belongs to the day when it starts on or before it and is still
 * running on it (end exclusive). One that covers the whole day reads "all
 * day"; one that began on an earlier day reads "until <end>".
 */
export function eventsOnDay(events: readonly SummaryEvent[], dayKey: string, timeZone: string): MorningSummaryEvent[] {
  const key = dayKeyFor({ kind: 'tz', timeZone })
  return events
    .filter((e) => e.end.getTime() >= e.start.getTime())
    .map((e) => {
      const startKey = key(e.start)
      const lastKey = e.end.getTime() > e.start.getTime() ? key(new Date(e.end.getTime() - 1)) : startKey
      return { e, startKey, lastKey }
    })
    .filter(({ startKey, lastKey }) => startKey <= dayKey && lastKey >= dayKey)
    .sort((a, b) => a.e.start.getTime() - b.e.start.getTime() || a.e.title.localeCompare(b.e.title))
    .map(({ e, startKey, lastKey }) => {
      const coversStart = startKey < dayKey || localMinutes(e.start, timeZone) === 0
      const coversEnd = lastKey > dayKey || (e.end.getTime() > e.start.getTime() && localMinutes(e.end, timeZone) === 0)
      let when: string
      if (coversStart && coversEnd) when = 'all day'
      else if (startKey === dayKey) when = `at ${formatClock(e.start, timeZone)}`
      else when = `until ${formatClock(e.end, timeZone)}`
      return { title: cleanTitle(e.title) || 'Event', when }
    })
}

function eventPhrase(e: MorningSummaryEvent): string {
  return e.when === 'all day' ? `${e.title} (all day)` : `${e.title} ${e.when}`
}

/**
 * The person's summary for their local `dayKey`, or null when there is
 * nothing to say (then nothing is sent).
 */
export function buildMorningSummary(input: MorningSummaryInput): MorningSummary | null {
  const { person, dayKey, timeZone, features } = input
  const isParent = person.role === 'parent'

  // Own chores only, open, due on the local day.
  let chores: MorningSummary['chores'] = null
  if (features.chores) {
    const mine = input.chores.filter((c) => c.assigneeId === person.id && c.dueDay === dayKey && isOpenStatus(c.status))
    if (mine.length > 0) {
      chores = {
        count: mine.length,
        titles: mine.slice(0, MAX_NAMED_CHORES).map((c) => cleanTitle(c.title) || 'Chore'),
      }
    }
  }

  let events: MorningSummary['events'] = null
  if (features.calendar) {
    const today = eventsOnDay(input.events, dayKey, timeZone)
    if (today.length > 0) {
      events = {
        items: today.slice(0, MAX_NAMED_EVENTS),
        more: Math.max(0, today.length - MAX_NAMED_EVENTS),
      }
    }
  }

  let dinner: string | null = null
  if (features.meals) {
    const tonight = input.dinners.find((d) => d.day === dayKey && cleanTitle(d.name))
    dinner = tonight ? cleanTitle(tonight.name) : null
  }

  const toCheck = isParent && features.chores && input.toCheckCount > 0 ? input.toCheckCount : null

  if (!chores && !events && !dinner && !toCheck) return null

  const parts: string[] = []
  const lines: string[] = []
  if (chores) {
    const extra = chores.count - chores.titles.length
    const names = chores.titles.join(', ') + (extra > 0 ? ` and ${extra} more` : '')
    parts.push(`${plural(chores.count, 'chore', 'chores')} (${names})`)
    lines.push(`Your ${plural(chores.count, 'chore', 'chores')}: ${names}`)
  }
  if (events) {
    const phrases = events.items.map(eventPhrase)
    const more = events.more > 0 ? ` and ${plural(events.more, 'more event', 'more events')}` : ''
    parts.push(phrases.join(', ') + more)
    lines.push(`On the calendar: ${phrases.join(', ')}${more}`)
  }
  if (dinner) {
    parts.push(`${dinner} for dinner`)
    lines.push(`Dinner: ${dinner}`)
  }
  if (toCheck) {
    parts.push(`${plural(toCheck, 'chore', 'chores')} to check`)
    lines.push(`Waiting for your check: ${plural(toCheck, 'chore', 'chores')}`)
  }

  let text = `Today: ${parts.join(', ')}.`
  if (text.length > MAX_SUMMARY_TEXT) text = `${text.slice(0, MAX_SUMMARY_TEXT - 1).trimEnd()}…`

  return {
    dayKey,
    dayLabel: dayLabelOf(dayKey),
    chores,
    events,
    dinner,
    toCheck,
    text,
    lines,
  }
}
