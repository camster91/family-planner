import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST - Create a reward
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true, role: true },
    })

    if (!user || user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can create rewards' }, { status: 403 })
    }

    if (!user.family_id) {
      return NextResponse.json({ error: 'You must belong to a family' }, { status: 400 })
    }

    const { title, description, point_cost } = await request.json()

    if (!title || !point_cost) {
      return NextResponse.json({ error: 'Title and point_cost are required' }, { status: 400 })
    }

    const reward = await prisma!.reward.create({
      data: {
        family_id: user.family_id,
        title,
        description: description || null,
        point_cost,
      },
    })

    return NextResponse.json({ reward })
  } catch (error) {
    console.error('Error creating reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Claim a reward
export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { rewardId } = await request.json()
    if (!rewardId) {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }

    const reward = await prisma!.reward.update({
      where: { id: rewardId },
      data: {
        claimed_by: userId,
        claimed_at: new Date(),
      },
    })

    return NextResponse.json({ reward })
  } catch (error) {
    console.error('Error claiming reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
