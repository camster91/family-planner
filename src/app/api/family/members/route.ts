import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const members = await prisma!.user.findMany({
      where: { family_id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        email: auth.user.role === 'parent' ? true : false, // Only parents see emails
        role: true,
        age: true,
        avatar_url: true,
        points: true,
        level: true,
        xp: true,
        streak: true,
        best_streak: true,
        badges: true,
      },
      orderBy: { role: 'desc' },
    })

    return NextResponse.json({ members })
  } catch (error) {
    console.error('Error fetching family members:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
