// Project task -> calendar event helpers for
// POST /api/projects/[id]/send-to-calendar.

import { toDateOnlyUTC } from '@/lib/dates'
import { zonedWallTimeToUtc } from '@/lib/calendar-import/timezone'

/**
 * Stable link from a calendar event back to the project task it came from,
 * kept in `Event.source_uid`. That column is otherwise only read together with
 * `source_subscription_id` (ICS imports), which stays null here, so the event
 * remains an ordinary editable in-app event.
 */
export const PROJECT_TASK_UID_PREFIX = 'project-task:'

export function projectTaskUid(taskId: string): string {
  return `${PROJECT_TASK_UID_PREFIX}${taskId}`
}

/**
 * All-day span for a date-only task due date (stored as UTC midnight of the
 * picked day): 00:00 to 23:59 of that calendar day in `timeZone`, the same
 * convention the event form and event import use for all-day events.
 */
export function allDayRange(dueDate: Date, timeZone: string): { start: Date; end: Date } {
  const [year, month, day] = toDateOnlyUTC(dueDate).split('-').map(Number)
  return {
    start: zonedWallTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone),
    end: zonedWallTimeToUtc({ year, month, day, hour: 23, minute: 59, second: 0 }, timeZone),
  }
}
