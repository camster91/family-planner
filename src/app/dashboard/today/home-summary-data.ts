/**
 * Data for the personal home summary on /dashboard/today (#268, #269).
 *
 * Only shared-surface chore fields every member may already read (title, due
 * day, status, assignee) and member display names, the same fields the Today
 * board shows (ROLE_AND_ISOLATION_MATRIX.md). No points, XP, photos or notes.
 * Scoped by the caller's `family_id`. Not loaded in fridge mode.
 *
 * Kept next to the page, apart from today-board-data.ts (the board's DTO).
 */
import type { PrismaClient } from '@prisma/client'
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import type { HomeChore, HomeMember } from '@/lib/home-summary'

const MAX_CHORES = 120

export interface HomeSummaryData {
  chores: HomeChore[]
  members: HomeMember[]
  toCheckCount: number
  choresHref: string | null
}

export async function loadHomeSummary(
  db: PrismaClient,
  opts: { familyId: string; role: string; now?: Date }
): Promise<HomeSummaryData> {
  const start = startOfTodayUTC(opts.now ?? new Date())
  const isParent = opts.role === 'parent'
  const [chores, members, toCheckCount] = await Promise.all([
    // Due dates are UTC-midnight date-only values: yesterday..tomorrow covers
    // "today" in any zone; the client picks the viewer's local day.
    db.chore.findMany({
      where: {
        family_id: opts.familyId,
        due_date: { gte: addUTCDays(start, -1), lte: addUTCDays(start, 1) },
      },
      select: { id: true, title: true, due_date: true, status: true, assigned_to: true },
      orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: MAX_CHORES,
    }),
    db.user.findMany({
      where: { family_id: opts.familyId },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    isParent ? db.chore.count({ where: { family_id: opts.familyId, status: 'completed' } }) : Promise.resolve(0),
  ])

  return {
    chores: chores.map((c) => ({
      id: c.id,
      title: c.title,
      dueDay: toDateOnlyUTC(c.due_date),
      status: c.status,
      assigneeId: c.assigned_to,
    })),
    members,
    toCheckCount,
    choresHref: canRoleAccessPath(opts.role, '/dashboard/chores') ? '/dashboard/chores' : null,
  }
}
