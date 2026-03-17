import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true },
    })

    if (!user?.family_id) {
      return NextResponse.json({ members: [] })
    }

    const members = await prisma!.user.findMany({
      where: { family_id: user.family_id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        age: true,
        avatar_url: true,
      },
      orderBy: { role: 'desc' },
    })

    return NextResponse.json({ members })
  } catch (error) {
    console.error('Error fetching family members:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
