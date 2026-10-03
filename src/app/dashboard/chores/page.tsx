import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ChoresContent from './ChoresContent'
import { isGamificationOn, omitChorePoints } from '@/lib/gamification-visibility'
import {
  CHORE_HISTORY_ORDER,
  CHORE_HISTORY_PAGE_SIZE,
  choreOrderBy,
  compareChoreOrder,
  currentChoreQueries,
  encodeChoreCursor,
} from '@/lib/chore-paging'
import { topUpHouseholdSeries } from '@/lib/recurringChores'
import { nextRotationMember } from '@/lib/chore-rotation'

export default async function ChoresPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  })

  const familyId = user?.family_id || undefined
  // Points & streaks (#248). When off, no chore points or streaks are computed
  // or sent to the client.
  const gamification = await isGamificationOn(familyId)

  // Recurring series are extended on read (there is no scheduler): a series
  // nobody ticks still shows its next weeks. Bounded, idempotent, never throws.
  if (familyId) await topUpHouseholdSeries(familyId)

  // Chores for the family (O-19 paging), bounded (`currentChoreQueries`):
  // open chores due in the last 60 days or later, verified chores due from
  // yesterday (UTC) on, and every chore waiting for a parent's check load in
  // full: the Today and Week views, the pending count and the verification
  // queue need them. Each of those reads is capped and drops the oldest rows
  // first. Older verified chores (history, seen under "All") are paged newest
  // first, in the same (due_date, id) order as
  // `GET /api/chores?limit=&cursor=&order=desc`, so the first page is the most
  // recent history and the client's "Load more" carries on, further back, from
  // `historyCursor`.
  const include = {
    assignee: { select: { name: true } },
    creator: { select: { name: true } },
  }
  const queries = familyId ? currentChoreQueries(familyId) : null
  const [open, awaitingCheck, history] = queries
    ? await Promise.all([
        prisma!.chore.findMany({ ...queries.open, include }),
        prisma!.chore.findMany({ ...queries.awaitingCheck, include }),
        prisma!.chore.findMany({
          where: { family_id: familyId, status: 'verified', due_date: { lt: queries.historyBefore } },
          include,
          orderBy: choreOrderBy(CHORE_HISTORY_ORDER),
          take: CHORE_HISTORY_PAGE_SIZE + 1,
        }),
      ])
    : [[], [], []]
  const current = [...open, ...awaitingCheck]
  const historyHasMore = history.length > CHORE_HISTORY_PAGE_SIZE
  const historyPage = historyHasMore ? history.slice(0, CHORE_HISTORY_PAGE_SIZE) : history
  const historyCursor = historyHasMore ? encodeChoreCursor(historyPage[historyPage.length - 1]) : null
  const chores = [...historyPage, ...current].sort(compareChoreOrder)

  // Compute streak per assignee: count of consecutive days with completed chores in last 7 days
  const streakMap: Record<string, number> = {}
  if (familyId && gamification) {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const completedChores = await prisma!.chore.findMany({
      where: {
        family_id: familyId,
        status: { in: ['completed', 'verified'] },
        completed_at: { gte: sevenDaysAgo },
      },
      select: { assigned_to: true, completed_at: true, title: true },
      orderBy: { completed_at: 'asc' },
    })

    // Group by assignee
    const byAssignee: Record<string, Date[]> = {}
    for (const c of completedChores) {
      if (!c.completed_at) continue
      if (!byAssignee[c.assigned_to]) byAssignee[c.assigned_to] = []
      byAssignee[c.assigned_to].push(new Date(c.completed_at))
    }

    for (const [assigneeId, dates] of Object.entries(byAssignee)) {
      // Get unique days
      const daySet = new Set<string>()
      for (const d of dates) daySet.add(d.toISOString().split('T')[0])
      const sortedDays = Array.from(daySet).sort()
      // Count consecutive days from today backwards
      let streak = 0
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = 0; i < 7; i++) {
        const checkDate = new Date(today)
        checkDate.setDate(today.getDate() - i)
        const dayStr = checkDate.toISOString().split('T')[0]
        if (daySet.has(dayStr)) {
          streak++
        } else {
          break
        }
      }
      streakMap[assigneeId] = streak >= 3 ? streak : 0
    }
  }

  // Get family members for assignment
  const familyMembers = familyId ? await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true, role: true, age: true },
    orderBy: { role: 'desc' }
  }) : []

  // Take turns (O-38): "Takes turns · next: Alex" on open rows of a rotating
  // series. One small read of the series templates on this page.
  const seriesIds = [
    ...new Set(
      chores
        .filter((c) => c.recurrence_id && c.rotation_index !== null && !['completed', 'verified', 'approved'].includes(c.status))
        .map((c) => c.recurrence_id as string)
    ),
  ]
  const rotations = new Map<string, string[]>()
  if (familyId && seriesIds.length > 0) {
    const templates = await prisma!.chore.findMany({
      where: { family_id: familyId, id: { in: seriesIds } },
      select: { id: true, rotation_member_ids: true },
    })
    for (const t of templates) rotations.set(t.id, t.rotation_member_ids)
  }
  const memberNames = new Map(familyMembers.map((m) => [m.id, m.name]))
  const rotationNextName = (c: (typeof chores)[number]): string | null => {
    if (!c.recurrence_id || ['completed', 'verified', 'approved'].includes(c.status)) return null
    const nextId = nextRotationMember(rotations.get(c.recurrence_id), c.rotation_index)
    return nextId ? (memberNames.get(nextId) ?? null) : null
  }

  const serializedChores = chores.map((c) => {
    const row = {
      ...c,
      due_date: c.due_date.toISOString(),
      created_at: c.created_at.toISOString(),
      completed_at: c.completed_at?.toISOString() ?? null,
      verified_at: c.verified_at?.toISOString() ?? null,
      photo_url: c.photo_url ?? null,
      streak: streakMap[c.assigned_to] ?? 0,
      rotation_next_name: rotationNextName(c),
    }
    return gamification ? row : omitChorePoints(row)
  })

  return (
    <ChoresContent
      chores={serializedChores as any}
      familyMembers={familyMembers as any}
      currentUserId={sessionUser.id}
      userRole={user?.role || 'child'}
      historyCursor={historyCursor}
    />
  )
}