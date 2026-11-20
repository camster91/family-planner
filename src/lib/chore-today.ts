/**
 * Which chores belong on "today" lists and counts (owner decision 2026-11-19).
 *
 * Before, the Today board, the Today summary and Chores › Today counted only
 * chores due on the viewer's local day, while the kid home also listed older
 * open chores. An open chore due three days ago ("Mow the lawn") was on the
 * teen's home but missing from Today, so the two disagreed ("2 chores left"
 * against 3). Now every surface uses this one rule: today's chores plus any
 * still-open chore whose due day has passed, shown with an "Overdue" label.
 *
 * Day keys are `YYYY-MM-DD`: the chore's stored UTC date-only day and the
 * viewer's local day (src/lib/dates.ts, O-31). Done chores from earlier days
 * never come back here.
 */

export const OPEN_CHORE_STATUSES = ['pending', 'in_progress', 'overdue'] as const

export function isOpenChoreStatus(status: string): boolean {
  return (OPEN_CHORE_STATUSES as readonly string[]).includes(status)
}

/** Still open and due before the viewer's local today. */
export function isOverdueChore(dueDay: string, status: string, todayKey: string): boolean {
  return dueDay < todayKey && isOpenChoreStatus(status)
}

/** Due on the viewer's local today, or overdue and still open. */
export function belongsToToday(dueDay: string, status: string, todayKey: string): boolean {
  return dueDay === todayKey || isOverdueChore(dueDay, status, todayKey)
}

/** Bound on the extra overdue rows a Today read adds (newest due first). */
export const MAX_OVERDUE_CHORES = 40
