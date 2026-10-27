import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body";
import { rewardActionCommandSchema, rewardActionCommandsEnabled, rewardActionOwnerMatches, rewardActionTimeRefusal, type RewardActionCommand } from "@/lib/reward-action-command";
import { protectRewardResponse } from "@/lib/reward-response"
import { rewardNotificationDestination } from "@/lib/notification-destination"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { idempotencyError, readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { approveReward, authorizeRewardReplay, type RewardActor } from '@/lib/reward-mutations'


// POST - Approve a claimed reward (parents only)
export async function handleRewardApprovalRequest(request: NextRequest, mode: "legacy" | "owned" = "legacy") {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate
    if (mode === "owned" && !rewardActionCommandsEnabled()) return NextResponse.json({ error: "Reward commands unavailable", code: "REWARD_COMMAND_UNAVAILABLE" }, { status: 503 })

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can approve rewards' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await readBoundedJson(request, 8192)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
    }
    let originalCommand: RewardActionCommand | null = null
    if (mode === "owned") {
      const command = rewardActionCommandSchema.safeParse(body)
      if (!command.success || command.data.kind !== "approve") return NextResponse.json({ error: "Invalid reward command", code: "REWARD_COMMAND_INVALID" }, { status: 400 })
      if (!rewardActionOwnerMatches(command.data, { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }))
        return NextResponse.json({ error: "Reward review owner changed", code: "REWARD_COMMAND_OWNER_CHANGED" }, { status: 409 })
      const timeRefusal = rewardActionTimeRefusal(command.data)
      if (timeRefusal) return NextResponse.json(timeRefusal.body, { status: timeRefusal.status })
      originalCommand = command.data
      body = { rewardId: originalCommand.rewardId }
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
    if (mode === "owned" && !key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED")

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
    })

    if (!reward || (mode === "owned" && reward.family_id !== auth.user.family_id)) return NextResponse.json({ error: 'Reward not found' }, { status: 404 })

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Let keyed retries reach the stored receipt after the first approval has
    // transitioned the row to redeemed; the helper guards fresh approvals.
    if (reward.status !== 'claimed' && !key) {
      return NextResponse.json({ error: 'Reward must be claimed before approval' }, { status: 400 })
    }

    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0, ...(originalCommand ? { originalCommand } : {}) }
    let applied = false
    let notificationHandled = false
    let claimerId: string | null | undefined
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${actor.userId}`, familyId: actor.familyId, userId: actor.userId, action: 'reward.approve' },
      originalCommand ?? { rewardId },
      async ({ recordId }) => {
        const mutation = await approveReward(prisma!, { rewardId }, actor, recordId)
        applied = mutation.applied
        notificationHandled = mutation.notificationHandled === true
        claimerId = mutation.claimerId
        return mutation.result
      },
      { beforeReplay: () => authorizeRewardReplay(prisma!, actor, true) },
    )

    // Notify the child only for the fresh conditional transition.
    if (applied && claimerId && !notificationHandled) {
      try {
        await notificationServiceServer.sendNotification({
          familyId: auth.user.family_id,
          userId: claimerId,
          title: 'Reward Approved!',
          message: `Your parent approved "${reward.name}". Enjoy your reward!`,
          type: 'reward',
          actionUrl: rewardNotificationDestination(rewardId),
        })
      } catch (err) {
        logRouteError('POST /api/rewards/approve (notification)', err, getRequestId(request))
      }
    }

    return protectRewardResponse(prisma!, actor, true, response)
  } catch (error) {
    logRouteError('POST /api/rewards/approve', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
