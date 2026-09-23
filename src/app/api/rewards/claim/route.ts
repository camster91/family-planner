import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { claimRewardSchema } from '@/lib/validations'
import { notificationServiceServer } from '@/lib/notifications-server'

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

    const body = await request.json()
    const parsed = claimRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId } = parsed.data

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      select: { id: true, family_id: true, cost: true, name: true, status: true },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (reward.status !== 'available') {
      return NextResponse.json({ error: 'Reward is not available' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({
      where: { id: auth.user.id },
      select: { name: true },
    })

    // Everything that decides the outcome runs in one transaction. Each write is
    // conditional, so correctness does not depend on the reads above still being
    // true by the time the writes land.
    const result = await prisma!.$transaction(async (tx) => {
      // Claim the reward only if it is still available. A concurrent claim that
      // got here first makes this match zero rows, and this attempt aborts.
      const claimedReward = await tx.reward.updateMany({
        where: { id: rewardId, status: 'available', family_id: auth.user.family_id },
        data: {
          status: 'claimed',
          claimed_by: auth.user.id,
          claimed_at: new Date(),
        },
      })

      if (claimedReward.count === 0) {
        return { ok: false as const, reason: 'Reward is no longer available' }
      }

      // Deduct XP only if the balance still covers it. `gte` makes the check and
      // the deduction one atomic operation; `increment` makes concurrent
      // deductions compose rather than overwrite.
      const deducted = await tx.user.updateMany({
        where: { id: auth.user.id, xp: { gte: reward.cost } },
        data: { xp: { decrement: reward.cost } },
      })

      if (deducted.count === 0) {
        // Not enough XP. Throwing rolls back the claim above, so the reward is
        // not left in a claimed state with no deduction.
        throw new InsufficientXpError()
      }

      const fresh = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { xp: true },
      })

      return { ok: true as const, xp: fresh?.xp ?? 0 }
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 409 })
    }

    const updated = await prisma!.reward.findUnique({
      where: { id: rewardId },
      include: {
        creator: { select: { id: true, name: true } },
        claimer: { select: { id: true, name: true } },
      },
    })

    // Notify parents (best effort, never blocks the claim)
    try {
      const parents = await prisma!.user.findMany({
        where: { family_id: auth.user.family_id, role: 'parent' },
        select: { id: true },
      })
      for (const parent of parents) {
        await notificationServiceServer.sendNotification({
          userId: parent.id,
          title: `${user?.name ?? 'Someone'} claimed a reward!`,
          message: `${user?.name ?? 'Someone'} claimed "${reward.name}" for ${reward.cost} XP.`,
          type: 'reward',
        })
      }
    } catch (err) {
      console.error('Error sending claim notification:', err)
    }

    return NextResponse.json({ reward: updated, xp: result.xp })
  } catch (error) {
    if (error instanceof InsufficientXpError) {
      return NextResponse.json({ error: 'Not enough XP for this reward' }, { status: 400 })
    }
    console.error('Error claiming reward:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

class InsufficientXpError extends Error {}
