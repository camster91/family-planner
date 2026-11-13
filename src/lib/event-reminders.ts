// In-app event reminders (default-off). No push and no scheduler: when a
// signed-in person's inbox is read, each event of theirs that starts within
// the next day gets one inbox row. EventReminder is the lasting proof, so a
// deleted, muted or already-written reminder never comes back.
import { isValidTimeZone } from './calendar-import/timezone'
import { localDayIn } from './event-series'

export const EVENT_REMINDERS_READY_ENV = 'FAMILY_EVENT_REMINDERS_READY'
export const eventRemindersReady = () => process.env[EVENT_REMINDERS_READY_ENV] === '1'

/** How far ahead of its start an event is "coming up", unless the person chose otherwise. */
export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000
/** The lead times a person can choose, in hours. A closed set; the database checks it too. */
export const REMINDER_LEAD_HOURS = [2, 12, 24, 48, 168] as const
export type ReminderLeadHours = typeof REMINDER_LEAD_HOURS[number]
export const DEFAULT_REMINDER_LEAD_HOURS: ReminderLeadHours = 24
export const isReminderLeadHours = (value: unknown): value is ReminderLeadHours =>
  typeof value === 'number' && (REMINDER_LEAD_HOURS as readonly number[]).includes(value)
/** The reminder window for a stored choice; anything unknown is the default. */
export const reminderWindowMs = (hours: unknown) => (isReminderLeadHours(hours) ? hours : DEFAULT_REMINDER_LEAD_HOURS) * 60 * 60 * 1000
/** Most reminders one inbox read writes; the rest follow on later reads. */
export const REMINDER_MAX_PER_READ = 10
/** Most candidate events one read looks at. */
export const REMINDER_SCAN = 60
/** The browser's IANA zone, sent with inbox reads so reminder times read in local time. */
export const REMINDER_TIME_ZONE_HEADER = 'x-herewoven-time-zone'
const TITLE_MAX = 120

/** The zone reminder times are written in: the browser's, else one the person saved. Null means no reminders now. */
export function reminderTimeZone(...candidates: Array<string | null | undefined>): string | null {
  for (const value of candidates) if (typeof value === 'string' && value.length <= 64 && isValidTimeZone(value)) return value
  return null
}

export type ReminderPerson = { user_id: string | null; member_id: string | null }
/**
 * Whether one account is reminded about an event. An event for nobody in
 * particular is for the whole family. Otherwise it is for the accounts named,
 * and a parent is also reminded when it names someone without an account.
 */
export function reminderIsFor(account: { id: string; role: string | null }, people: ReminderPerson[]): boolean {
  if (people.length === 0) return true
  if (people.some((person) => person.user_id === account.id)) return true
  return account.role === 'parent' && people.some((person) => person.user_id === null && person.member_id !== null)
}

/** Inbox text for one reminder. Stored as written, like every other inbox row. */
export function reminderText(event: { title: string; start: number }, timeZone: string, nowMs: number): { title: string; message: string } {
  const name = event.title.trim().replace(/\s+/g, ' ')
  const title = `Coming up: ${name.length > TITLE_MAX ? `${name.slice(0, TITLE_MAX - 1)}…` : name}`
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(event.start))
  const today = localDayIn(nowMs, timeZone), day = localDayIn(event.start, timeZone)
  // Further out than tomorrow the date is spelled out: a weekday alone could mean this week or next.
  const when = day === today ? 'Today' : day === localDayIn(nowMs + REMINDER_WINDOW_MS, timeZone) ? 'Tomorrow'
    : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(event.start))
  return { title, message: `${when} at ${time}` }
}
