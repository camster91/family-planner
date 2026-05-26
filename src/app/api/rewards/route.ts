import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createRewardSchema, updateRewardSchema } from '@/lib/validations'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

// GET - List rewards for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (status) where.status = status

    const rewards = await prisma!.reward.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ rewards })
  } catch (error) {
    console.error('Error fetching rewards:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new reward (parents only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can create rewards' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, point_cost, icon } = parsed.data

    const reward = await prisma!.reward.create({
      data: {
        family_id: auth.user.family_id,
        name: title,
        description: description || null,
        cost: point_cost,
        icon: icon || 'gift',
        status: 'available',
        created_by: auth.user.id,
      },
      include: {
        creator: { select: { id: true, name: true } },
      },
    })

    // Notify family members about new reward
    try {
      const members = await prisma!.user.findMany({
        where: { family_id: auth.user.family_id, id: { not: auth.user.id } },
        select: { id: true },
      })
      for (const member of members) {
        await notificationServiceServer.sendNotification({
          userId: member.id,
          title: 'New Reward Available!',
          message: `${title} is now available for ${point_cost} points`,
          type: 'reward',
        })
      }
    } catch (err) {
      console.error('Error sending reward notification:', err)
    }

    return NextResponse.json({ reward })
  } catch (error) {
    console.error('Error creating reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a reward (parents only)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can update rewards' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId, ...updates } = parsed.data

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      select: { family_id: true },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    const updateData: Record<string, unknown> = {}
    if (updates.title !== undefined) updateData.name = updates.title
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.point_cost !== undefined) updateData.cost = updates.point_cost
    if (updates.icon !== undefined) updateData.icon = updates.icon

    const updated = await prisma!.reward.update({
      where: { id: rewardId },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ reward: updated })
  } catch (error) {
    console.error('Error updating reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
