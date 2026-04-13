import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { createRewardSchema, claimRewardSchema, updateRewardSchema, deleteRewardSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - List rewards for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const rewards = await prisma!.reward.findMany({
      where: { family_id: auth.user.family_id },
      include: {
        claimant: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ rewards })
  } catch (error) {
    console.error('Error fetching rewards:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a reward (parents only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = createRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, point_cost, icon } = parsed.data

    const reward = await prisma!.reward.create({
      data: {
        family_id: auth.user.family_id,
        title,
        description: description || null,
        point_cost,
        icon,
      },
    })

    return NextResponse.json({ reward })
  } catch (error) {
    console.error('Error creating reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Claim a reward (family-scoped, points check)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = claimRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }

    // Verify reward belongs to user's family and is unclaimed
    const reward = await prisma!.reward.findUnique({
      where: { id: parsed.data.rewardId },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.claimed_by) {
      return NextResponse.json({ error: 'Reward already claimed' }, { status: 400 })
    }

    // Check user has enough points
    if (auth.user.points < reward.point_cost) {
      return NextResponse.json({
        error: `Not enough points. You need ${reward.point_cost - auth.user.points} more points.`,
      }, { status: 400 })
    }

    // Claim reward and deduct points atomically
    const [updatedReward] = await prisma!.$transaction([
      prisma!.reward.update({
        where: { id: parsed.data.rewardId },
        data: {
          claimed_by: auth.user.id,
          claimed_at: new Date(),
        },
      }),
      prisma!.user.update({
        where: { id: auth.user.id },
        data: {
          points: { decrement: reward.point_cost },
        },
      }),
    ])

    // Record activity
    await prisma!.activity.create({
      data: {
        family_id: auth.user.family_id,
        user_id: auth.user.id,
        type: 'reward_claimed',
        title: `${auth.user.name} claimed "${reward.title}"`,
        description: `Spent ${reward.point_cost} points`,
        metadata: JSON.stringify({ rewardId: reward.id, pointCost: reward.point_cost }),
      },
    })

    return NextResponse.json({ reward: updatedReward, pointsDeducted: reward.point_cost })
  } catch (error) {
    console.error('Error claiming reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Edit a reward (parents only, unclaimed only)
export async function PUT(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = updateRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId, ...updates } = parsed.data

    const reward = await prisma!.reward.findUnique({ where: { id: rewardId } })
    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.claimed_by) {
      return NextResponse.json({ error: 'Cannot edit a claimed reward' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.point_cost !== undefined) data.point_cost = updates.point_cost
    if (updates.icon !== undefined) data.icon = updates.icon

    const updated = await prisma!.reward.update({
      where: { id: rewardId },
      data,
      include: { claimant: { select: { name: true } } },
    })

    return NextResponse.json({ reward: updated })
  } catch (error) {
    console.error('Error updating reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a reward (parents only, unclaimed only)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
    const parsed = deleteRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }

    const reward = await prisma!.reward.findUnique({ where: { id: parsed.data.rewardId } })
    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.claimed_by) {
      return NextResponse.json({ error: 'Cannot delete a claimed reward' }, { status: 400 })
    }

    await prisma!.reward.delete({ where: { id: parsed.data.rewardId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
