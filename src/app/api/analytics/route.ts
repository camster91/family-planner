import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    // Get user's family
    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true }
    })

    if (!user || !user.family_id) {
      return NextResponse.json({ error: 'User not in a family' }, { status: 400 })
    }

    // Get date ranges for analytics
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Get family members
    const familyMembers = await prisma!.user.findMany({
      where: { family_id: user.family_id },
      select: { id: true, name: true, role: true }
    })

    // Get all chores for the family
    const allChores = await prisma!.chore.findMany({
      where: { family_id: user.family_id },
      include: { assignee: { select: { name: true } } }
    })

    // Get completed chores in the last 30 days
    const recentCompletedChores = await prisma!.chore.findMany({
      where: {
        family_id: user.family_id,
        status: { in: ['completed', 'verified'] },
        completed_at: { gte: oneMonthAgo }
      },
      include: { assignee: { select: { name: true } } }
    })

    // Get weekly completion data
    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
      const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const dateEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)

      const dayChores = recentCompletedChores?.filter((chore: any) => {
        if (!chore.completed_at) return false
        const completedDate = new Date(chore.completed_at)
        return completedDate >= dateStart && completedDate < dateEnd
      }) || []

      return {
        date: date.toISOString().split('T')[0],
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        count: dayChores.length,
        points: dayChores.reduce((sum: number, chore: any) => sum + (chore.points || 0), 0)
      }
    })

    // Get member participation
    const memberParticipation = familyMembers?.map((member: any) => {
      const memberChores = allChores?.filter((chore: any) => chore.assigned_to === member.id) || []
      const completedChores = memberChores.filter((chore: any) =>
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
        totalPoints: completedChores.reduce((sum: number, chore: any) => sum + (chore.points || 0), 0)
      }
    }) || []

    // Calculate family statistics
    const totalChores = allChores?.length || 0
    const completedChores = allChores?.filter((chore: any) =>
      chore.status === 'completed' || chore.status === 'verified'
    ).length || 0
    const completionRate = totalChores > 0
      ? Math.round((completedChores / totalChores) * 100)
      : 0

    // Calculate points statistics
    const totalPoints = completedChores > 0
      ? allChores?.filter((chore: any) =>
          chore.status === 'completed' || chore.status === 'verified'
        ).reduce((sum: number, chore: any) => sum + (chore.points || 0), 0) || 0
      : 0

    // Get most active day
    const dayCounts: Record<string, number> = {}
    recentCompletedChores?.forEach((chore: any) => {
      if (chore.completed_at) {
        const day = new Date(chore.completed_at).toLocaleDateString('en-US', { weekday: 'long' })
        dayCounts[day] = (dayCounts[day] || 0) + 1
      }
    })

    const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]

    // Calculate streaks (simplified)
    const sortedCompletedDates = recentCompletedChores
      ?.map((chore: any) => chore.completed_at ? new Date(chore.completed_at).toISOString().split('T')[0] : null)
      .filter(Boolean)
      .sort()
      .reverse() || []

    let currentStreak = 0
    if (sortedCompletedDates.length > 0) {
      const today = now.toISOString().split('T')[0]
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      // Check if we have completion today or yesterday for streak calculation
      if (sortedCompletedDates[0] === today) {
        currentStreak = 1
        for (let i = 1; i < sortedCompletedDates.length; i++) {
          const expectedDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          if (sortedCompletedDates[i] === expectedDate) {
            currentStreak++
          } else {
            break
          }
        }
      } else if (sortedCompletedDates[0] === yesterday) {
        currentStreak = 1
        // Check backwards from yesterday
        for (let i = 1; i < sortedCompletedDates.length; i++) {
          const expectedDate = new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          if (sortedCompletedDates[i] === expectedDate) {
            currentStreak++
          } else {
            break
          }
        }
      }
    }

    // Get top performers
    const topPerformers = [...memberParticipation]
      .sort((a, b) => b.completedChores - a.completedChores)
      .slice(0, 3)

    // Get chore difficulty distribution
    const difficultyDistribution = {
      easy: allChores?.filter((chore: any) => chore.difficulty === 'easy').length || 0,
      medium: allChores?.filter((chore: any) => chore.difficulty === 'medium').length || 0,
      hard: allChores?.filter((chore: any) => chore.difficulty === 'hard').length || 0
    }

    return NextResponse.json({
      summary: {
        totalChores,
        completedChores,
        completionRate,
        totalPoints,
        currentStreak,
        mostActiveDay: mostActiveDay ? {
          day: mostActiveDay[0],
          count: mostActiveDay[1]
        } : null
      },
      weeklyTrend: weeklyData,
      memberParticipation,
      topPerformers,
      difficultyDistribution,
      recentActivity: recentCompletedChores?.slice(0, 10).map((chore: any) => ({
        id: chore.id,
        title: chore.title,
        points: chore.points,
        completedAt: chore.completed_at,
        assignee: chore.assignee?.name
      })) || []
    })

  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
