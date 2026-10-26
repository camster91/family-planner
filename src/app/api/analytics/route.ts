import { ANALYTICS_SUMMARY_PROJECTION, ANALYTICS_WINDOW_DAYS, MAX_ANALYTICS_CHORES, ANALYTICS_SUMMARY_COVERAGE, ANALYTICS_SUMMARY_LIMIT_CODE } from "@/lib/analytics-summary-contract";
import { PRIVATE_TIMELINE_ACTIONS } from "@/lib/review-inbox/timeline-contract";
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { legacyAnalyticsTypeFilter } from '@/lib/legacy-analytics'
import { addDaysToKey, dayKeyFor, parseLocalZone, weekdayOfKey } from '@/lib/local-day-key'
import { isGamificationOn } from '@/lib/gamification-visibility'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000
const DONE_STATUSES = ['completed', 'verified']

// GET /api/analytics?tz=<IANA>|tzOffset=<minutes>
// Days (weekly trend, most active day, streak) are the viewer's local days
// (O-31: client local time, server UTC). Rates cover the last 90 days and never
// count a chore that is not due yet.
export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const original = Object.freeze({ actorId: auth.user.id, familyId: auth.user.family_id,
      role: auth.user.role, generation: auth.payload.tv ?? 0 })
    const privateResponse = (response: NextResponse) => {
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
    const gate = await featureGate(original.familyId, 'analytics')
    if (gate) return privateResponse(gate)
    // Reads below may wait on the database. Renew feature access, then the
    // original principal after that wait, before returning either private
    // summary data or the household's size-limit result. This is a point-in-
    // time HTTP check, not membership/feature serialization or a DB snapshot.
    const reply = async (body: unknown, status = 200) => {
      const currentGate = await featureGate(original.familyId, 'analytics')
      const [current, refused] = await authenticateWithFamily(request)
      if (refused) return privateResponse(refused)
      if (current.user.id !== original.actorId || current.user.family_id !== original.familyId ||
        current.user.role !== original.role || (current.payload.tv ?? 0) !== original.generation)
        return privateResponse(NextResponse.json({ code: 'ANALYTICS_SCOPE_CHANGED',
          error: 'Your account or household changed. Reload progress.' }, { status: 409 }))
      if (currentGate) return privateResponse(currentGate)
      return privateResponse(NextResponse.json(body, { status }))
    }

    const query = new URL(request.url).searchParams
    if (query.has('projection') && (query.getAll('projection').length !== 1 || query.get('projection') !== ANALYTICS_SUMMARY_PROJECTION))
      return NextResponse.json({ error: 'Invalid analytics projection' }, { status: 400 })
    const summaryOnly = query.get('projection') === ANALYTICS_SUMMARY_PROJECTION
    // Without `tz`/`tzOffset` (older clients), UTC days as before.
    const zone = parseLocalZone(query)
    if (!zone) {
      return NextResponse.json({ error: 'Invalid time zone' }, { status: 400 })
    }
    const dayKey = dayKeyFor(zone)

    const familyId = original.familyId
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
        take: MAX_ANALYTICS_CHORES + (summaryOnly ? 1 : 0),
      }),
      prisma!.chore.findMany({
        where: {
          family_id: familyId,
          status: { in: DONE_STATUSES },
          completed_at: { gte: windowStart, lte: now },
        },
        select: { id: true, assigned_to: true, points: true, completed_at: true },
        orderBy: { completed_at: 'desc' },
        take: MAX_ANALYTICS_CHORES + (summaryOnly ? 1 : 0),
      }),
      summaryOnly ? Promise.resolve([]) : prisma!.activity.findMany({
        // Legacy page-view/click rows are not household activity (#136).
        where: { family_id: familyId, NOT: { type: legacyAnalyticsTypeFilter() }, type: {notIn: [...PRIVATE_TIMELINE_ACTIONS]} },
        include: { user: { select: { name: true } } },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ])

    // One lookahead row distinguishes a complete exactly-at-cap collection
    // from a truncated one. Never turn an incomplete compact read into totals.
    // Legacy requests retain their established cap/body pending compatibility work.
    if (summaryOnly && (allChores.length > MAX_ANALYTICS_CHORES || recentCompletedChores.length > MAX_ANALYTICS_CHORES))
      return await reply({ code: ANALYTICS_SUMMARY_LIMIT_CODE, error: 'This progress window exceeds the supported summary size.' }, 422)

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
    // Count each bounded chore once; do not rescan the full window for each
    // member. Unassigned/former-member chores still count in family totals.
    const countsByMember = new Map<string, { total: number; completed: number }>()
    for (const chore of allChores) {
      if (!chore.assigned_to) continue
      const counts = countsByMember.get(chore.assigned_to) ?? { total: 0, completed: 0 }
      counts.total++
      if (DONE_STATUSES.includes(chore.status)) counts.completed++
      countsByMember.set(chore.assigned_to, counts)
    }
    const memberParticipation = familyMembers.map(member => {
      const counts = countsByMember.get(member.id) ?? { total: 0, completed: 0 }
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        totalChores: counts.total,
        completedChores: counts.completed,
        completionRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
      }
    })
    const participationById = new Map(memberParticipation.map(member => [member.id, member]))

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
      // due_date is a date-only value stored as UTC midnight: key it by its
      // UTC day, not the viewer's zone (that would move it a day back west of UTC).
      const key = new Date(c.due_date).toISOString().slice(0, 10)
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
        const participation = participationById.get(m.id)
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

    return await reply({
      ...(summaryOnly ? { coverage: ANALYTICS_SUMMARY_COVERAGE } : {}),
      summary: {
        totalChores,
        completedChores,
        completionRate,
        currentStreak,
        ...(!summaryOnly ? { mostActiveDay: mostActiveDay ? { day: mostActiveDay[0], count: mostActiveDay[1] } : null } : {}),
      },
      weeklyTrend: weeklyData,
      weeklyCompletion,
      gamification,
      members,
      ...(!summaryOnly ? {
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
      } : {}),
    })
  } catch (error) {
    logRouteError('GET /api/analytics', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
