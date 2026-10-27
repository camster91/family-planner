import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body"
import { projectRewardPeople } from "@/lib/reward-people"
import { withRewardReadAccess } from "@/lib/reward-read-access"
import { protectRewardResponse } from "@/lib/reward-response"
import { parseRewardPaging, readRewardPage } from '@/lib/reward-paging'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createRewardSchema, updateRewardSchema } from '@/lib/validations'
import { notificationServiceServer } from '@/lib/notifications-server'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeRewardReplay, createReward, updateReward, type RewardActor } from '@/lib/reward-mutations'

export const dynamic = 'force-dynamic'

// GET - List rewards for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }
    const respond = async (result: Awaited<ReturnType<typeof withRewardReadAccess>>) => {
      const response = result.kind === 'held'
        ? NextResponse.json(result.result.body, { status: result.result.status, headers: { 'Cache-Control': 'private, no-store' } })
        : NextResponse.json(result.value, { headers: { 'Cache-Control': 'private, no-store' } })
      return protectRewardResponse(prisma!, actor, false, response, "read")
    }
    // Exact target inspection is separate from collection absence. Legacy
    // servers may ignore this opt-in filter; the client still matches the ID.
    if (searchParams.has('rewardId')) {
      const id = searchParams.get('rewardId')!
      if (searchParams.getAll('rewardId').length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || ['limit', 'cursor', 'status'].some(key => searchParams.has(key)))
        return NextResponse.json({ error: 'Invalid reward target', code: 'REWARDS_INVALID_PAGE' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
      const result = await withRewardReadAccess(prisma!, actor, async tx => ({ rewards: await projectRewardPeople(tx, actor.familyId, await tx.reward.findMany({
        where: { family_id: actor.familyId, id }, take: 1,
      })) }))
      return respond(result)
    }
    const paging = parseRewardPaging(searchParams, auth.user.family_id)
    if (!paging.ok) return NextResponse.json({ error: paging.error, code: 'REWARDS_INVALID_PAGE' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
    if (paging.paged) return respond(await withRewardReadAccess(prisma!, actor, tx => readRewardPage(tx, actor.familyId, paging)))

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (status) where.status = status

    const result = await withRewardReadAccess(prisma!, actor, async tx => ({ rewards: await projectRewardPeople(tx, actor.familyId, await tx.reward.findMany({
      where,
      orderBy: { created_at: 'desc' },
    })) }))

    return respond(result)
  } catch (error) {
    logRouteError('GET /api/rewards', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new reward (parents only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can create rewards' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await readBoundedJson(request, 16 * 1024)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
    }
    const parsed = createRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError
    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }
    let applied = false
    let notificationHandled = false
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${actor.userId}`, familyId: actor.familyId, userId: actor.userId, action: 'reward.create' },
      parsed.data,
      async ({ recordId }) => {
        const mutation = await createReward(prisma!, parsed.data, actor, recordId)
        applied = mutation.applied
        notificationHandled = mutation.notificationHandled === true
        return mutation.result
      },
      { beforeReplay: () => authorizeRewardReplay(prisma!, actor, true) },
    )

    // Notify family members about new reward
    if (applied && !notificationHandled) {
      try {
        const members = await prisma!.user.findMany({
          where: { family_id: auth.user.family_id, id: { not: auth.user.id } },
          select: { id: true },
        })
        for (const member of members) {
          await notificationServiceServer.sendNotification({
            familyId: auth.user.family_id,
            userId: member.id,
            title: 'New Reward Available!',
            message: `${parsed.data.name} is now available for ${parsed.data.cost} points`,
            type: 'reward',
          })
        }
      } catch (err) {
        logRouteError('POST /api/rewards (notification)', err, getRequestId(request))
      }
    }

    return protectRewardResponse(prisma!, actor, true, response)
  } catch (error) {
    logRouteError('POST /api/rewards', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a reward (parents only)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'rewards')
    if (gate) return gate

    if (auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can update rewards' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await readBoundedJson(request, 16 * 1024)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
    }
    const parsed = updateRewardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { rewardId } = parsed.data

    const reward = await prisma!.reward.findUnique({
      where: { id: rewardId },
      select: { family_id: true },
    })

    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(reward.family_id, auth.user.family_id)
    if (familyError) return familyError

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError
    const actor: RewardActor = { familyId: auth.user.family_id, userId: auth.user.id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${actor.userId}`, familyId: actor.familyId, userId: actor.userId, action: 'reward.update' },
      parsed.data,
      ({ recordId }) => updateReward(prisma!, parsed.data, actor, recordId).then((mutation) => mutation.result),
      { beforeReplay: () => authorizeRewardReplay(prisma!, actor, true) },
    )
    return protectRewardResponse(prisma!, actor, true, response)
  } catch (error) {
    logRouteError('PATCH /api/rewards', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
