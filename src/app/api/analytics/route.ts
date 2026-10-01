import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { legacyAnalyticsTypeFilter } from '@/lib/legacy-analytics'
import { addDaysToKey, dayKeyFor, parseLocalZone, weekdayOfKey } from '@/lib/local-day-key'
import { isGamificationOn } from '@/lib/gamification-visibility'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000
const ANALYTICS_WINDOW_DAYS = 90
// Safety cap on rows per query; a household's 90 days stays far below it.
const MAX_ANALYTICS_CHORES = 5000
const DONE_STATUSES = ['completed', 'verified']

// GET /api/analytics?tz=<IANA>|tzOffset=<minutes>
// Days (weekly trend, most active day, streak) are the viewer's local days
// (O-31: client local time, server UTC). Rates cover the last 90 days and never
// count a chore that is not due yet.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'analytics')
    if (gate) return gate

    // Without `tz`/`tzOffset` (older clients), UTC days as before.
    const zone = parseLocalZone(new URL(request.url).searchParams)
    if (!zone) {
      return NextResponse.json({ error: 'Invalid time zone' }, { status: 400 })
    }
    const dayKey = dayKeyFor(zone)

    const familyId = auth.user.family_id
    const now = new Date()
    const oneMonthAgo = new Date(now.getTime() - 30 * DAY_MS)
    // Bounded window: the last 90 days, never the future.
    const windowStart = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * DAY_MS)

    // Parallel queries for efficiency
    const [familyMembers, allChores, recentCompletedChores, recentActivities] = await Promise.all([
      prisma!.user.findMany({
        where: { family_id: familyId },
        select: { id: true, name: true, role: true, avatar_url: true, xp: true, level: true, streak: true, best_streak: true },
      }),
      // Chores that count toward the rates: due in the window up to now, or
      // completed in the window. A future occurrence (a recurring series
      // generates them ahead) is not due yet, so it is left out of the
      // denominator unless it was already done.
      prisma!.chore.findMany({
        where: {
          family_id: familyId,
          OR: [
            { due_date: { gte: windowStart, lte: now } },
            { status: { in: DONE_STATUSES }, completed_at: { gte: windowStart, lte: now } },
          ],
        },
        select: { id: true, assigned_to: true, status: true, points: true, difficulty: true, completed_at: true, due_date: true },
        orderBy: [{ due_date: 'desc' }, { id: 'asc' }],
        take: MAX_ANALYTICS_CHORES,
      }),
      prisma!.chore.findMany({
        where: {
          family_id: familyId,
          status: { in: DONE_STATUSES },
          completed_at: { gte: windowStart, lte: now },
        },
        select: { id: true, assigned_to: true, points: true, completed_at: true },
        orderBy: { completed_at: 'desc' },
        take: MAX_ANALYTICS_CHORES,
      }),
      prisma!.activity.findMany({
        // Legacy page-view/click rows are not household activity (#136).
        where: { family_id: familyId, NOT: { type: legacyAnalyticsTypeFilter() } },
        include: { user: { select: { name: true } } },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ])

    // Completed chores by the viewer's local day.
    const completedByDay = new Map<string, { count: number; points: number }>()
    for (const chore of recentCompletedChores) {
      if (!chore.completed_at) continue
      const key = dayKey(new Date(chore.completed_at))
      const entry = completedByDay.get(key) ?? { count: 0, points: 0 }
      entry.count += 1
      entry.points += chore.points || 0
      completedByDay.set(key, entry)
    }

    // Weekly completion data: the last 7 local days, today last.
    const today = dayKey(now)
    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const dateStr = addDaysToKey(today, i - 6)
      const entry = completedByDay.get(dateStr)
      return {
        date: dateStr,
        day: weekdayOfKey(dateStr, 'short'),
        count: entry?.count ?? 0,
        points: entry?.points ?? 0,
      }
    })

    // Member participation
    const memberParticipation = familyMembers.map(member => {
      const memberChores = allChores.filter(chore => chore.assigned_to === member.id)
      const completedChores = memberChores.filter(chore => DONE_STATUSES.includes(chore.status))

      return {
        id: member.id,
        name: member.name,
        role: member.role,
        totalChores: memberChores.length,
        completedChores: completedChores.length,
        completionRate: memberChores.length > 0
          ? Math.round((completedChores.length / memberChores.length) * 100)
          : 0,
      }
    })

    // Family statistics
    const totalChores = allChores.length
    const completedChores = allChores.filter(c => DONE_STATUSES.includes(c.status)).length
    const completionRate = totalChores > 0 ? Math.round((completedChores / totalChores) * 100) : 0

    // Most active (local) weekday over the last 30 days
    const dayCounts: Record<string, number> = {}
    recentCompletedChores.forEach(chore => {
      if (chore.completed_at && new Date(chore.completed_at) >= oneMonthAgo) {
        const day = weekdayOfKey(dayKey(new Date(chore.completed_at)))
        dayCounts[day] = (dayCounts[day] || 0) + 1
      }
    })
    const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]

    // Streak: consecutive local days with a completion, ending today or
    // yesterday (today may not be done yet).
    let currentStreak = 0
    let cursor = completedByDay.has(today) ? today : addDaysToKey(today, -1)
    while (completedByDay.has(cursor)) {
      currentStreak++
      cursor = addDaysToKey(cursor, -1)
    }

    // Top performers — sort by completed chores
    const topPerformers = [...memberParticipation]
      .sort((a, b) => b.completedChores - a.completedChores)
      .slice(0, 3)

    // Weekly completion: chores due in the last 7 local days (today included)
    // that are done. Matches the "this week" ring on the analytics page.
    const weekStart = addDaysToKey(today, -6)
    const dueThisWeek = allChores.filter((c) => {
      if (!c.due_date) return false
      const key = dayKey(new Date(c.due_date))
      return key >= weekStart && key <= today
    })
    const weeklyCompletion =
      dueThisWeek.length > 0
        ? Math.round((dueThisWeek.filter((c) => DONE_STATUSES.includes(c.status)).length / dueThisWeek.length) * 100)
        : 0

    // Members for the page's list. XP, level and streaks only when the family
    // has Points & streaks on (#248); otherwise just completion counts.
    const gamification = await isGamificationOn(familyId)
    const members = familyMembers
      .map((m) => {
        const participation = memberParticipation.find((p) => p.id === m.id)
        const base = {
          id: m.id,
          name: m.name,
          role: m.role,
          avatar_url: m.avatar_url,
          completedChores: participation?.completedChores ?? 0,
          totalChores: participation?.totalChores ?? 0,
        }
        return gamification
          ? { ...base, xp: m.xp, level: m.level, streak: m.streak, best_streak: m.best_streak }
          : base
      })
      .sort((a, b) =>
        gamification
          ? ((b as { xp?: number }).xp ?? 0) - ((a as { xp?: number }).xp ?? 0)
          : b.completedChores - a.completedChores
      )

    // Difficulty distribution
    const difficultyDistribution = {
      easy: allChores.filter(c => c.difficulty === 'easy').length,
      medium: allChores.filter(c => c.difficulty === 'medium').length,
      hard: allChores.filter(c => c.difficulty === 'hard').length,
    }

    return NextResponse.json({
      summary: {
        totalChores,
        completedChores,
        completionRate,
        currentStreak,
        mostActiveDay: mostActiveDay ? { day: mostActiveDay[0], count: mostActiveDay[1] } : null,
      },
      weeklyTrend: weeklyData,
      weeklyCompletion,
      gamification,
      members,
      memberParticipation,
      topPerformers,
      difficultyDistribution,
      recentActivity: recentActivities.map(a => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        createdAt: a.created_at,
        userName: a.user.name,
      })),
    })
  } catch (error) {
    logRouteError('GET /api/analytics', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
