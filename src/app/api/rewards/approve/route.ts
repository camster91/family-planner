import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { approveReward, authorizeRewardReplay, type RewardActor } from '@/lib/reward-mutations'

export const dynamic = 'force-dynamic'

// POST - Approve a claimed reward (parents only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can approve rewards' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const { rewardId } = body as { rewardId?: unknown }
    if (!rewardId || typeof rewardId !== 'string') {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }
    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      include: { claimer: { select: { id: true, name: true } } },
    })

    if (!reward) return NextResponse.json({ error: 'Reward not found' }, { status: 404 })

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Let keyed retries reach the stored receipt after the first approval has
    // transitioned the row to redeemed; the helper guards fresh approvals.
    if (reward.status !== 'claimed' && !key) {
      return NextResponse.json({ error: 'Reward must be claimed before approval' }, { status: 400 })
    }

    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role }
    let applied = false
    let claimerId: string | null | undefined
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${actor.userId}`, familyId: actor.familyId, userId: actor.userId, action: 'reward.approve' },
      { rewardId },
      async ({ recordId }) => {
        const mutation = await approveReward(prisma!, { rewardId }, actor, recordId)
        applied = mutation.applied
        claimerId = mutation.claimerId
        return mutation.result
      },
      { beforeReplay: () => authorizeRewardReplay(prisma!, actor, true) },
    )

    // Notify the child only for the fresh conditional transition.
    if (applied && claimerId) {
      try {
        await notificationServiceServer.sendNotification({
          familyId: auth.user.family_id,
          userId: claimerId,
          title: 'Reward Approved!',
          message: `Your parent approved "${reward.name}". Enjoy your reward!`,
          type: 'reward',
        })
      } catch (err) {
        logRouteError('POST /api/rewards/approve (notification)', err, getRequestId(request))
      }
    }

    return response
  } catch (error) {
    logRouteError('POST /api/rewards/approve', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
