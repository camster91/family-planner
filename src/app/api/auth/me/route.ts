import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { getLevelTitle } from '@/lib/gamification'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    const payload = verifyToken(token)
    if (!payload || !payload.userId) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        age: true,
        family_id: true,
        avatar_url: true,
        points: true,
        level: true,
        xp: true,
        streak: true,
        best_streak: true,
        created_at: true,
        family: {
          select: { id: true, name: true, subscription_tier: true },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        ...user,
        levelTitle: getLevelTitle(user.level),
      },
    })
  } catch (error) {
    console.error('Auth me error:', error)
    return NextResponse.json({ user: null }, { status: 500 })
  }
}
