// Project task -> calendar event helpers for
// POST /api/projects/[id]/send-to-calendar.

import { toDateOnlyUTC } from '@/lib/dates'
import { zonedWallTimeToUtc } from '@/lib/calendar-import/timezone'
import type { Prisma } from '@prisma/client'

export const PROJECT_CALENDAR_TASK_BATCH = 200

/**
 * Caller holds current user/household/project authority in the effect transaction.
 * Immutable task IDs drive internal traversal; UI position changes never skip a
 * remaining task. Grouped existence reads return at most one row per candidate
 * UID/title, even if old calendars contain many duplicate events.
 */
export async function readProjectCalendarTaskBatch(
  tx: Prisma.TransactionClient,
  scope: { familyId: string; projectId: string },
  afterId: string | null,
) {
  const tasks = await tx.projectTask.findMany({
    where: {
      project_id: scope.projectId, project: { family_id: scope.familyId },
      completed: false, due_date: { not: null },
      ...(afterId ? { id: { gt: afterId } } : {}),
    },
    select: { id: true, title: true, description: true, due_date: true },
    orderBy: { id: 'asc' }, take: PROJECT_CALENDAR_TASK_BATCH,
  })
  if (tasks.length === 0) return { tasks, unsent: tasks }
  const where = { family_id: scope.familyId, project_id: scope.projectId, is_task: true }
  const [linked, legacy] = await Promise.all([
    tx.event.groupBy({
      by: ['source_uid'], where: {
        ...where, source_uid: { in: tasks.map((task) => projectTaskUid(task.id)) },
      },
    }),
    tx.event.groupBy({
      by: ['title'], where: {
        ...where, title: { in: [...new Set(tasks.map((task) => task.title))] },
        OR: [{ source_uid: null }, { source_uid: '' }],
      },
    }),
  ])
  const linkedUids = new Set(linked.map((event) => event.source_uid))
  const legacyTitles = new Set(legacy.map((event) => event.title))
  return {
    tasks,
    unsent: tasks.filter((task) => !linkedUids.has(projectTaskUid(task.id)) && !legacyTitles.has(task.title)),
  }
}

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

/**
 * Lock a project's row until the caller's transaction commits. Send to
 * calendar reads which tasks are already on the calendar and then creates the
 * rest; two sends at once (a double tap, two parents) used to both see none
 * and create every event twice. Under this lock the second send waits and
 * then finds the first one's events.
 */
export async function lockProjectRow(tx: any, projectId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`
}
