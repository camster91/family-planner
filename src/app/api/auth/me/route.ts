import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Full session validation, including the session-generation check — a
    // cookie revoked by a password reset must not still read the profile.
    const [payload, authError] = await authenticateRequest(request)
    if (authError) {
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
        created_at: true,
        xp: true,
        level: true,
        streak: true,
        best_streak: true,
        last_chore_date: true,
        family: {
          select: { id: true, name: true, subscription_tier: true },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Auth me error:', error)
    return NextResponse.json({ user: null }, { status: 500 })
  }
}
