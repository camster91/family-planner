// Receipt-safe reward mutations: retrying a committed request must replay the
// same envelope without repeating XP, row transitions, metrics, or notices.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))
jest.mock('@/lib/beta-metrics', () => ({ recordBetaMetric: jest.fn(async () => undefined) }))
jest.mock('@/lib/notifications-server', () => {
  const sendNotification = jest.fn(async () => undefined)
  return { notificationServiceServer: { sendNotification, notifyChoreAssignment: async () => undefined } }
})

import * as rewards from '../route'
import { POST as claim } from '../claim/route'
import { POST as approve } from '../approve/route'
import { bodyOf, db, fakePrisma, req, writesTo } from '@/__tests__/helpers/two-household'
import { notificationServiceServer } from '@/lib/notifications-server'
import { hashDeviceToken } from '@/lib/device-session'
import { recordBetaMetric } from '@/lib/beta-metrics'

const KEY = '1a9f7c2e-5d41-4e60-8b23-7c1d9f4a2e60'
const NEXT_KEY = '2b0a8d3f-6e52-4f71-9c34-8d2e0a5b3f71'
type ClaimUser = 'parentA' | 'teenA' | 'childA'
const send = notificationServiceServer.sendNotification as jest.Mock
const metric = recordBetaMetric as jest.Mock

describe('Rewards idempotency', () => {
  beforeEach(() => {
    db.reset()
    db.find('family', 'family-A')!.features = { gamification: true, rewards: true }
    db.find('family', 'family-B')!.features = { gamification: true, rewards: true }
    send.mockClear()
    metric.mockClear()
  })

  // Authored UNRUN. No Content-Length: enforce the stream bound before effect/receipt allocation.
  it.each([
    ['create', rewards.POST, 'parentA', 16 * 1024],
    ['edit', rewards.PATCH, 'parentA', 16 * 1024],
    ['claim', claim, 'childA', 8192],
    ['approve', approve, 'parentA', 8192],
  ] as const)('bounds legacy %s streamed JSON before writes', async (_name, handle, as, limit) => {
    const request = req({ as, headers: { 'Idempotency-Key': KEY } })
    const decoder = jest.fn(async () => { throw new Error('Unbounded decoder must not run') })
    request.json = decoder
    request.body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(' '.repeat(limit + 1)))
        controller.close()
      },
    })
    const response = await handle(request)
    expect(response.status).toBe(413)
    expect(decoder).not.toHaveBeenCalled()
    expect(writesTo('reward')).toHaveLength(0)
    expect(writesTo('idempotencyRecord')).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects malformed idempotency keys before any reward write', async () => {
    const response = await rewards.POST(req({
      as: 'parentA',
      body: { name: 'Bad key', cost: 5 },
      headers: { 'Idempotency-Key': 'not-a-valid-key' },
    }))
    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error.code).toBe('IDEMPOTENCY_KEY_INVALID')
    expect(writesTo('reward')).toHaveLength(0)
  })

  it('rechecks the effective Rewards dependency before a mutation', async () => {
    db.find('family', 'family-A')!.features = { gamification: false, rewards: true }
    const response = await rewards.POST(req({ as: 'parentA', body: { name: 'Hidden', cost: 5 } }))
    expect(response.status).toBe(403)
    expect(await bodyOf(response)).toEqual({ error: 'This feature is turned off for your family' })
    expect(writesTo('reward')).toHaveLength(0)
  })

  it('treats a null legacy feature blob as the real default policy', async () => {
    db.find('family', 'family-A')!.features = null
    const response = await rewards.POST(req({ as: 'parentA', body: { name: 'Legacy default', cost: 5 } }))
    expect(response.status).toBe(403)
    expect(await bodyOf(response)).toEqual({ error: 'This feature is turned off for your family' })
    expect(writesTo('reward')).toHaveLength(0)
  })

  it('refuses a live paired device before a lingering person cookie can claim', async () => {
    process.env.SHARED_DEVICE_ENABLED = '1'
    try {
      const future = new Date(Date.now() + 60 * 60 * 1000)
      db.rows('householdDevice').push({ id: 'device-reward-a', family_id: 'family-A', revoked_at: null })
      db.rows('deviceSession').push({
        id: 'device-session-reward-a',
        device_id: 'device-reward-a',
        family_id: 'family-A',
        access_token_hash: hashDeviceToken('reward-tablet-token'),
        refresh_token_hash: 'reward-refresh-hash',
        access_expires_at: future,
        refresh_expires_at: future,
        revoked_at: null,
        rotated_at: null,
      })
      const request = req({ as: 'parentA', body: { rewardId: 'reward-a' } })
      request.cookies = {
        get: (name: string) =>
          name === 'fp_device'
            ? { value: 'reward-tablet-token' }
            : name === 'session_token'
              ? { value: 'session:parent-a' }
              : undefined,
      }
      const response = await claim(request)
      expect(response.status).toBe(403)
      expect((await bodyOf(response)).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
      expect(writesTo('reward')).toHaveLength(0)
    } finally {
      delete process.env.SHARED_DEVICE_ENABLED
    }
  })

  it('creates one reward and one notification fanout across a lost-response retry', async () => {
    const input = { name: 'Movie night', cost: 80, icon: 'film' }
    const first = await rewards.POST(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))
    const retry = await rewards.POST(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    expect(JSON.stringify(await retry.json())).toBe(JSON.stringify(await first.json()))
    expect(db.rows('reward').filter((row) => row.name === input.name)).toHaveLength(1)
    expect(writesTo('reward').filter((write) => write.op === 'create')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('rejects a changed create body under the same key without a second row', async () => {
    const first = await rewards.POST(req({
      as: 'parentA',
      body: { name: 'Dessert', cost: 40 },
      headers: { 'Idempotency-Key': KEY },
    }))
    const changed = await rewards.POST(req({
      as: 'parentA',
      body: { name: 'Dessert', cost: 60 },
      headers: { 'Idempotency-Key': KEY },
    }))

    expect(first.status).toBe(200)
    expect(changed.status).toBe(422)
    expect((await bodyOf(changed)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(db.rows('reward').filter((row) => row.name === 'Dessert')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('rechecks parent authority before replaying a private create response', async () => {
    const input = { name: 'Parent only', cost: 25 }
    const first = await rewards.POST(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))
    db.find('user', 'parent-a')!.role = 'teen'
    const replay = await rewards.POST(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))

    expect(first.status).toBe(200)
    expect(replay.status).toBe(403)
    expect(db.rows('reward').filter((row) => row.name === input.name)).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('updates a reward once and replays the parent edit envelope', async () => {
    const input = { rewardId: 'reward-a', cost: 35, name: 'Updated reward' }
    const first = await rewards.PATCH(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))
    const retry = await rewards.PATCH(req({ as: 'parentA', body: input, headers: { 'Idempotency-Key': KEY } }))

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    expect(db.find('reward', 'reward-a')).toMatchObject({ name: input.name, cost: input.cost })
    expect(writesTo('reward').filter((write) => write.op === 'update')).toHaveLength(1)
  })

  it('claims once and replays the XP/result envelope for all-person claim authority', async () => {
    const first = await claim(req({ as: 'childA', body: { rewardId: 'reward-a' }, headers: { 'Idempotency-Key': KEY } }))
    const retry = await claim(req({ as: 'childA', body: { rewardId: 'reward-a' }, headers: { 'Idempotency-Key': KEY } }))

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    expect((await bodyOf(retry)).xp).toBe(490)
    expect(db.find('user', 'child-a')?.xp).toBe(490)
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'claimed', claimed_by: 'child-a' })
    expect(writesTo('reward').filter((write) => write.op === 'updateMany')).toHaveLength(1)
    expect(metric).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses an inactive reward without debiting points and lets the same key retry after reactivation', async () => {
    db.find('reward', 'reward-a')!.is_active = false
    const key = '3c1b8a7e-4f62-4d91-a835-6e2f0b7c9a14'

    const refused = await claim(req({
      as: 'childA',
      body: { rewardId: 'reward-a' },
      headers: { 'Idempotency-Key': key },
    }))
    expect(refused.status).toBe(400)
    expect(await bodyOf(refused)).toEqual({ error: 'Reward is not available' })
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'available', is_active: false })
    expect(db.find('user', 'child-a')?.xp).toBe(500)
    expect(writesTo('reward').filter((write) => write.op === 'updateMany')).toHaveLength(0)
    expect(db.rows('idempotencyRecord')).toHaveLength(0)
    expect(metric).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    db.find('reward', 'reward-a')!.is_active = true
    const retried = await claim(req({
      as: 'childA',
      body: { rewardId: 'reward-a' },
      headers: { 'Idempotency-Key': key },
    }))
    expect(retried.status).toBe(200)
    expect(retried.headers.get('Idempotency-Replayed')).toBeNull()
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'claimed', claimed_by: 'child-a' })
    expect(db.find('user', 'child-a')?.xp).toBe(490)
  })

  it('replays a committed claim after the reward is later deactivated', async () => {
    const key = '4d2c9b8f-5a73-4e02-b946-7f3a1c8d0b25'
    const first = await claim(req({
      as: 'childA',
      body: { rewardId: 'reward-a' },
      headers: { 'Idempotency-Key': key },
    }))
    expect(first.status).toBe(200)
    db.find('reward', 'reward-a')!.is_active = false

    const replay = await claim(req({
      as: 'childA',
      body: { rewardId: 'reward-a' },
      headers: { 'Idempotency-Key': key },
    }))
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect((await bodyOf(replay)).xp).toBe(490)
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'claimed', is_active: false })
    expect(db.find('user', 'child-a')?.xp).toBe(490)
  })

  it('keeps already claimed inactive rewards approvable for history completion', async () => {
    const reward = db.find('reward', 'reward-a')!
    reward.status = 'claimed'
    reward.claimed_by = 'child-a'
    reward.claimed_at = new Date()
    reward.is_active = false

    const response = await approve(req({ as: 'parentA', body: { rewardId: 'reward-a' } }))
    expect(response.status).toBe(200)
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'redeemed', is_active: false })
  })

  it.each<ClaimUser>(['parentA', 'teenA', 'childA'])('%s can claim a same-family reward', async (who) => {
    const response = await claim(req({ as: who, body: { rewardId: 'reward-a' } }))
    expect(response.status).toBe(200)
    const ids = { parentA: 'parent-a', teenA: 'teen-a', childA: 'child-a' } as const
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'claimed', claimed_by: ids[who] })
  })

  it('returns in-progress for a concurrent duplicate before the first keyed effect commits', async () => {
    const originalCreate = fakePrisma.reward.create
    let release!: () => void
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    fakePrisma.reward.create = async (args: unknown) => {
      signalStarted()
      await blocked
      return originalCreate(args)
    }
    try {
      const first = rewards.POST(req({ as: 'parentA', body: { name: 'Pool time', cost: 20 }, headers: { 'Idempotency-Key': KEY } }))
      await started
      const duplicate = await rewards.POST(req({ as: 'parentA', body: { name: 'Pool time', cost: 20 }, headers: { 'Idempotency-Key': KEY } }))
      expect(duplicate.status).toBe(409)
      expect((await bodyOf(duplicate)).error.code).toBe('IDEMPOTENCY_IN_PROGRESS')
      release()
      expect((await first).status).toBe(200)
      expect(db.rows('reward').filter((row) => row.name === 'Pool time')).toHaveLength(1)
    } finally {
      fakePrisma.reward.create = originalCreate
    }
  })

  it('approves claimed -> redeemed once and refuses a second fresh-key transition', async () => {
    const reward = db.find('reward', 'reward-a')!
    reward.status = 'claimed'
    reward.claimed_by = 'child-a'
    reward.claimed_at = new Date()

    const first = await approve(req({ as: 'parentA', body: { rewardId: 'reward-a' }, headers: { 'Idempotency-Key': KEY } }))
    const retry = await approve(req({ as: 'parentA', body: { rewardId: 'reward-a' }, headers: { 'Idempotency-Key': KEY } }))
    const secondKey = await approve(req({ as: 'parentA', body: { rewardId: 'reward-a' }, headers: { 'Idempotency-Key': NEXT_KEY } }))

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    expect(secondKey.status).toBe(400)
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'redeemed', approved_by: 'parent-a' })
    expect(writesTo('reward').filter((write) => write.op === 'updateMany')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
