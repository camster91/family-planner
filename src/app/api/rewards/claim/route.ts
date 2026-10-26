import { rewardNotificationDestination } from "@/lib/notification-destination"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { claimRewardSchema } from '@/lib/validations'
import { notificationServiceServer } from '@/lib/notifications-server'
import { featureGate } from '@/lib/feature-gate-server'
import { recordBetaMetric } from '@/lib/beta-metrics'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeRewardReplay, claimReward, InsufficientRewardXpError, type RewardActor } from '@/lib/reward-mutations'

export const dynamic = 'force-dynamic'

// POST - Claim a reward (children/teens)
//
// Concurrency (#185): the previous version read the reward's availability and the
// user's XP OUTSIDE the transaction, then wrote `xp: (user.xp || 0) - cost` — an
// absolute value, not an increment, with no `status: 'available'` predicate on
// the write. Two concurrent claims of the same reward both passed the pre-check
// and both deducted; two claims of different rewards last-write-wins the XP
// column, so one deduction was silently lost.
//
// Now the whole decision happens inside one transaction, guarded by conditional
// writes that the database evaluates atomically:
//   * the reward is claimed with `updateMany({ where: { status: 'available' } })`
//     and the claim aborts if it matched zero rows;
//   * XP is deducted with `updateMany({ where: { xp: { gte: cost } } })`, so the
//     balance check and the deduction cannot be interleaved;
//   * XP uses `increment`, never an absolute write, so concurrent deductions
//     compose instead of overwriting each other.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = claimRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId } = parsed.data
    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      select: { id: true, family_id: true, cost: true, name: true, status: true },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Let keyed retries reach the stored receipt after the first claim changes
    // the status; a fresh keyed attempt is still refused inside the helper.
    if (reward.status !== 'available' && !key) {
      return NextResponse.json({ error: 'Reward is not available' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({
      where: { id: auth.user.id },
      select: { name: true },
    })

    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }
    let applied = false
    let notificationHandled = false
    let chargedCost = reward.cost
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${actor.userId}`, familyId: actor.familyId, userId: actor.userId, action: 'reward.claim' },
      parsed.data,
      async ({ recordId }) => {
        const mutation = await claimReward(prisma!, parsed.data, actor, recordId)
        applied = mutation.applied
        notificationHandled = mutation.notificationHandled === true
        chargedCost = mutation.cost ?? chargedCost
        return mutation.result
      },
      { beforeReplay: () => authorizeRewardReplay(prisma!, actor, false) },
    )

    if (applied) {
      // Beta usage counts (#287): after the commit; never fails the request.
      await recordBetaMetric(prisma!, auth.user.family_id, 'reward_claimed')

      // Notify parents only for the fresh mutation. A lost-response replay
      // cannot duplicate the metric or notification fanout.
      if (!notificationHandled) try {
        const parents = await prisma!.user.findMany({
          where: { family_id: auth.user.family_id, role: 'parent' },
          select: { id: true },
        })
        for (const parent of parents) {
          await notificationServiceServer.sendNotification({
            familyId: auth.user.family_id,
            userId: parent.id,
            title: `${user?.name ?? 'Someone'} claimed a reward!`,
            message: `${user?.name ?? 'Someone'} claimed "${reward.name}" for ${chargedCost} points.`,
            type: 'reward',
            actionUrl: rewardNotificationDestination(rewardId),
          })
        }
      } catch (err) {
        logRouteError('POST /api/rewards/claim (notification)', err, getRequestId(request))
      }
    }

    return response
  } catch (error) {
    if (error instanceof InsufficientRewardXpError) {
      return NextResponse.json({ error: 'Not enough points for this reward' }, { status: 400 })
    }
    logRouteError('POST /api/rewards/claim', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
