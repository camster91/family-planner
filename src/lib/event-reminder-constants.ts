// Dependency-free constants for in-app event reminders. Browser code imports
// these from here so the dashboard shell does not pull in the date and series
// rules that src/lib/event-reminders.ts needs on the server.

/** The browser's IANA zone, sent with inbox reads so reminder times read in local time. */
export const REMINDER_TIME_ZONE_HEADER = 'x-herewoven-time-zone'
/** The lead times a person can choose, in hours. A closed set; the database checks it too. */
export const REMINDER_LEAD_HOURS = [2, 12, 24, 48, 168] as const
export type ReminderLeadHours = typeof REMINDER_LEAD_HOURS[number]
export const DEFAULT_REMINDER_LEAD_HOURS: ReminderLeadHours = 24
export const isReminderLeadHours = (value: unknown): value is ReminderLeadHours =>
  typeof value === 'number' && (REMINDER_LEAD_HOURS as readonly number[]).includes(value)
