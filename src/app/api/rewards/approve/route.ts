import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

// POST - Approve a claimed reward (parents only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can approve rewards' }, { status: 403 })
    }

    const body = await request.json()
    const { rewardId } = body
    if (!rewardId || typeof rewardId !== 'string') {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      include: { claimer: { select: { id: true, name: true } } },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.status !== 'claimed') {
      return NextResponse.json({ error: 'Reward must be claimed before approval' }, { status: 400 })
    }

    const updated = await prisma!.reward.update({
      where: { id: rewardId },
      data: {
        status: 'redeemed',
        approved: true,
        approved_by: auth.user.id,
        approved_at: new Date(),
        redeemed_at: new Date(),
      },
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    })

    // Notify the child
    if (reward.claimer) {
      try {
        await notificationServiceServer.sendNotification({
          userId: reward.claimer.id,
          title: 'Reward Approved!',
          message: `Your parent approved "${reward.name}". Enjoy your reward!`,
          type: 'reward',
        })
      } catch (err) {
        console.error('Error sending approval notification:', err)
      }
    }

    return NextResponse.json({ reward: updated })
  } catch (error) {
    console.error('Error approving reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
