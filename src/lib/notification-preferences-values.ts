/** Canonical own-preferences projection and explicit patch shared by both stores. */
import { preferencesFromRow, preferencesToColumns, morningSummaryFromRow } from './notification-policy'
import { quietHoursFromRow, quietHoursToColumns } from './quiet-hours'
export type NotificationPreferencePatch = {
  chores?: boolean; events?: boolean; messages?: boolean;
  quietHours?: { enabled: boolean; start: string; end: string; timeZone?: string | null };
  morningSummary?: { enabled: boolean; timeZone?: string | null };
}
export function notificationPreferencesBody(row: Parameters<typeof preferencesFromRow>[0] & Parameters<typeof quietHoursFromRow>[0] & Parameters<typeof morningSummaryFromRow>[0]) {
  return { preferences: preferencesFromRow(row), quietHours: quietHoursFromRow(row), morningSummary: morningSummaryFromRow(row) }
}
export function notificationPreferencesColumns(patch: NotificationPreferencePatch) {
  const { quietHours, morningSummary, ...switches } = patch
  return {
    ...preferencesToColumns(switches),
    ...(quietHours ? quietHoursToColumns({ ...quietHours, timeZone: quietHours.timeZone ?? null }) : {}),
    ...(morningSummary ? { morning_summary_enabled: morningSummary.enabled, ...(morningSummary.timeZone !== undefined ? { morning_summary_time_zone: morningSummary.timeZone } : {}) } : {}),
  }
}
