import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET - Family activity feed
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)
    const cursor = searchParams.get('cursor')

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (cursor) {
      where.created_at = { lt: new Date(cursor) }
    }

    const activities = await prisma!.activity.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, avatar_url: true, level: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    return NextResponse.json({ activities })
  } catch (error) {
    console.error('Error fetching activities:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
