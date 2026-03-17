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

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    try {
      // Build query - lists table may not be in Prisma schema yet
      const whereClause: any = { family_id: user.family_id }
      if (type) {
        whereClause.type = type
      }

      const lists = await (prisma as any).list.findMany({
        where: whereClause,
        include: {
          _count: { select: { items: true } },
          creator: { select: { name: true } }
        },
        orderBy: { updated_at: 'desc' }
      })

      return NextResponse.json({ lists })
    } catch (error) {
      console.error('Error fetching lists:', error)
      return NextResponse.json({ lists: [] })
    }

  } catch (error) {
    console.error('Error fetching lists:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
