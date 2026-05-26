import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { claimRewardSchema } from '@/lib/validations'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

// POST - Claim a reward (children/teens)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = claimRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId } = parsed.data

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      include: { family: true },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.status !== 'available') {
      return NextResponse.json({ error: 'Reward is not available' }, { status: 400 })
    }

    // Check if user has enough XP to claim
    const user = await prisma!.user.findUnique({
      where: { id: auth.user.id },
      select: { xp: true, name: true },
    })

    if (!user || (user.xp || 0) < reward.cost) {
      return NextResponse.json(
        { error: `You need ${reward.cost} XP to claim this reward. You have ${user?.xp || 0} XP.` },
        { status: 400 }
      )
    }

    // Deduct XP and claim reward
    await prisma!.user.update({
      where: { id: auth.user.id },
      data: { xp: (user.xp || 0) - reward.cost },
    })

    const updated = await prisma!.reward.update({
      where: { id: rewardId },
      data: {
        status: 'claimed',
        claimed_by: auth.user.id,
        claimed_at: new Date(),
      },
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    })

    // Notify parents
    try {
      const parents = await prisma!.user.findMany({
        where: { family_id: auth.user.family_id, role: 'parent' },
        select: { id: true },
      })
      for (const parent of parents) {
        await notificationServiceServer.sendNotification({
          userId: parent.id,
          title: `${user.name} claimed a reward!`,
          message: `${user.name} claimed "${reward.name}" for ${reward.cost} XP.`,
          type: 'reward',
        })
      }
    } catch (err) {
      console.error('Error sending claim notification:', err)
    }

    return NextResponse.json({ reward: updated })
  } catch (error) {
    console.error('Error claiming reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
