// POST /api/rewards/claim charges the price stored when the claim commits.
// The reward was read before the transaction and that copy's `cost` was
// deducted, so a parent who raised (or lowered) the price in between was
// ignored. The cost is now read inside the transaction, after the claim.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))
jest.mock('@/lib/notifications-server', () => {
  const sendNotification = jest.fn(async () => undefined)
  return { notificationServiceServer: { sendNotification, notifyChoreAssignment: async () => undefined } }
})

import { POST as claim } from '../claim/route'
import { notificationServiceServer } from '@/lib/notifications-server'
import { bodyOf, db, fakePrisma, req } from '@/__tests__/helpers/two-household'

const send = notificationServiceServer.sendNotification as jest.Mock

describe('POST /api/rewards/claim cost', () => {
  let originalFindUnique: (args: unknown) => Promise<unknown>

  beforeEach(() => {
    db.reset()
    send.mockClear()
    originalFindUnique = fakePrisma.reward.findUnique
  })
  afterEach(() => {
    fakePrisma.reward.findUnique = originalFindUnique
  })

  it('deducts the price stored at claim time, not the one read before the transaction', async () => {
    db.find('user', 'child-a')!.xp = 100
    let reads = 0
    fakePrisma.reward.findUnique = async (args: unknown) => {
      const row = await originalFindUnique(args)
      // A parent raises the price right after the route's first read.
      if (++reads === 1) db.find('reward', 'reward-a')!.cost = 40
      return row
    }

    const res = await claim(req({ as: 'childA', body: { rewardId: 'reward-a' } }))
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).xp).toBe(60)
    expect(db.find('user', 'child-a')!.xp).toBe(60)
    expect(db.find('reward', 'reward-a')).toMatchObject({ status: 'claimed', claimed_by: 'child-a' })
    expect(send.mock.calls.some((c: any[]) => /for 40 points/.test(c[0].message))).toBe(true)
  })

  it('refuses when the new price is more than the balance and deducts nothing', async () => {
    db.find('user', 'child-a')!.xp = 30
    let reads = 0
    fakePrisma.reward.findUnique = async (args: unknown) => {
      const row = await originalFindUnique(args)
      if (++reads === 1) db.find('reward', 'reward-a')!.cost = 40
      return row
    }

    const res = await claim(req({ as: 'childA', body: { rewardId: 'reward-a' } }))
    expect(res.status).toBe(400)
    expect(db.find('user', 'child-a')!.xp).toBe(30)
  })
})
