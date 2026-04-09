import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { getLevelTitle, getBadgeById, xpProgress } from '@/lib/gamification'

export const dynamic = 'force-dynamic'

// GET - Leaderboard and gamification data for the family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // Get all family members with gamification data
    const members = await prisma!.user.findMany({
      where: { family_id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        avatar_url: true,
        points: true,
        level: true,
        xp: true,
        streak: true,
        best_streak: true,
        role: true,
        badges: true,
      },
      orderBy: { xp: 'desc' },
    })

    // Build leaderboard
    const leaderboard = members.map((member, index) => ({
      rank: index + 1,
      id: member.id,
      name: member.name,
      avatar_url: member.avatar_url,
      points: member.points,
      level: member.level,
      xp: member.xp,
      xpProgress: xpProgress(member.xp),
      levelTitle: getLevelTitle(member.level),
      streak: member.streak,
      bestStreak: member.best_streak,
      role: member.role,
      badgeCount: member.badges.length,
      badges: member.badges.map(b => ({
        ...b,
        definition: getBadgeById(b.badge_id),
      })),
    }))

    // Current user stats
    const currentUser = leaderboard.find(m => m.id === auth.user.id)

    // Family-wide stats
    const totalPoints = members.reduce((sum, m) => sum + m.points, 0)
    const totalBadges = members.reduce((sum, m) => sum + m.badges.length, 0)
    const highestStreak = Math.max(...members.map(m => m.streak), 0)

    return NextResponse.json({
      leaderboard,
      currentUser,
      familyStats: {
        totalPoints,
        totalBadges,
        highestStreak,
        memberCount: members.length,
      },
    })
  } catch (error) {
    console.error('Error fetching gamification data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
