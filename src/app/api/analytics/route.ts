import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const familyId = auth.user.family_id
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Parallel queries for efficiency
    const [familyMembers, allChores, recentCompletedChores, recentActivities] = await Promise.all([
      prisma!.user.findMany({
        where: { family_id: familyId },
        select: { id: true, name: true, role: true, points: true, level: true, xp: true, streak: true, best_streak: true },
      }),
      prisma!.chore.findMany({
        where: { family_id: familyId },
        select: { id: true, assigned_to: true, status: true, points: true, difficulty: true, completed_at: true },
      }),
      prisma!.chore.findMany({
        where: {
          family_id: familyId,
          status: { in: ['completed', 'verified'] },
          completed_at: { gte: oneMonthAgo },
        },
        select: { id: true, assigned_to: true, points: true, completed_at: true },
        orderBy: { completed_at: 'desc' },
      }),
      prisma!.activity.findMany({
        where: { family_id: familyId },
        include: { user: { select: { name: true } } },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ])

    // Weekly completion data
    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
      const dateStr = date.toISOString().split('T')[0]

      const dayChores = recentCompletedChores.filter(chore => {
        if (!chore.completed_at) return false
        return new Date(chore.completed_at).toISOString().split('T')[0] === dateStr
      })

      return {
        date: dateStr,
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        count: dayChores.length,
        points: dayChores.reduce((sum, chore) => sum + (chore.points || 0), 0),
      }
    })

    // Member participation
    const memberParticipation = familyMembers.map(member => {
      const memberChores = allChores.filter(chore => chore.assigned_to === member.id)
      const completedChores = memberChores.filter(chore =>
        chore.status === 'completed' || chore.status === 'verified'
      )

      return {
        id: member.id,
        name: member.name,
        role: member.role,
        totalChores: memberChores.length,
        completedChores: completedChores.length,
        completionRate: memberChores.length > 0
          ? Math.round((completedChores.length / memberChores.length) * 100)
          : 0,
        totalPoints: member.points,
        level: member.level,
        xp: member.xp,
        streak: member.streak,
        bestStreak: member.best_streak,
      }
    })

    // Family statistics
    const totalChores = allChores.length
    const completedChores = allChores.filter(c => c.status === 'completed' || c.status === 'verified').length
    const completionRate = totalChores > 0 ? Math.round((completedChores / totalChores) * 100) : 0
    const totalPoints = familyMembers.reduce((sum, m) => sum + m.points, 0)

    // Most active day
    const dayCounts: Record<string, number> = {}
    recentCompletedChores.forEach(chore => {
      if (chore.completed_at) {
        const day = new Date(chore.completed_at).toLocaleDateString('en-US', { weekday: 'long' })
        dayCounts[day] = (dayCounts[day] || 0) + 1
      }
    })
    const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]

    // Streak calculation
    const uniqueDatesSet = new Set(
      recentCompletedChores
        .map(c => c.completed_at ? new Date(c.completed_at).toISOString().split('T')[0] : '')
        .filter(d => d !== '')
    )
    const uniqueDates = Array.from(uniqueDatesSet).sort().reverse()

    let currentStreak = 0
    if (uniqueDates.length > 0) {
      const today = now.toISOString().split('T')[0]
      const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0]

      if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
        currentStreak = 1
        const startDate = uniqueDates[0] === today ? now : new Date(now.getTime() - 86400000)
        for (let i = 1; i < uniqueDates.length; i++) {
          const expected = new Date(startDate.getTime() - i * 86400000).toISOString().split('T')[0]
          if (uniqueDates[i] === expected) currentStreak++
          else break
        }
      }
    }

    // Top performers
    const topPerformers = [...memberParticipation]
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 3)

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
        totalPoints,
        currentStreak,
        mostActiveDay: mostActiveDay ? { day: mostActiveDay[0], count: mostActiveDay[1] } : null,
      },
      weeklyTrend: weeklyData,
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
    console.error('Error fetching analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
