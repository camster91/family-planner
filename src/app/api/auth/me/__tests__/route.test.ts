jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({ authenticateRequest: jest.fn() }))
jest.mock('@/lib/device-refusal', () => ({ refusePairedDevice: jest.fn(async () => null) }))
jest.mock('@/lib/storage-backend', () => ({ storageBackend: jest.fn() }))
jest.mock('@/lib/cloudflare/database', () => ({ getD1Database: jest.fn(async () => ({})) }))
jest.mock('@/lib/cloudflare/accounts', () => ({ findD1AuthMeUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))
jest.mock('@/lib/gamification-visibility', () => ({
  isGamificationOn: jest.fn(),
  omitUserGamification: jest.fn((row: Record<string, unknown>) => {
    const out = { ...row }
    for (const field of ['xp', 'level', 'streak', 'best_streak', 'last_chore_date']) delete out[field]
    return out
  }),
}))

import { GET } from '../route'
import { authenticateRequest } from '@/lib/api-auth'
import { findD1AuthMeUser } from '@/lib/cloudflare/accounts'
import { storageBackend } from '@/lib/storage-backend'
import { isGamificationOn } from '@/lib/gamification-visibility'

const auth = authenticateRequest as jest.Mock
const findNative = findD1AuthMeUser as jest.Mock
const backend = storageBackend as jest.Mock
const gamification = isGamificationOn as jest.Mock

const baseUser = {
  id: 'user-a',
  email: 'parent@example.test',
  name: 'Parent',
  role: 'parent',
  age: null,
  family_id: 'family-a',
  avatar_url: null,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  xp: 12,
  level: 2,
  streak: 3,
  best_streak: 4,
  last_chore_date: null,
  family: { id: 'family-a', name: 'Home', subscription_tier: 'free' },
}

describe('GET /api/auth/me native D1 path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    backend.mockReturnValue('d1')
    auth.mockResolvedValue([{ userId: 'user-a', tv: 3 }, null])
  })

  it('uses the direct result and strips gamification when the family has it off', async () => {
    findNative.mockResolvedValue({ user: baseUser, familyFeatures: { gamification: false } })

    const response = await GET({} as any)

    expect(response.status).toBe(200)
    const withoutGamification: Record<string, unknown> = { ...baseUser }
    delete withoutGamification.xp
    delete withoutGamification.level
    delete withoutGamification.streak
    delete withoutGamification.best_streak
    delete withoutGamification.last_chore_date
    expect(await response.json()).toEqual({
      user: withoutGamification,
    })
    expect(findNative).toHaveBeenCalledWith({}, 'user-a', 3)
    expect(gamification).not.toHaveBeenCalled()
  })

  it('keeps gamification fields when the family has it on without leaking the feature blob', async () => {
    findNative.mockResolvedValue({ user: baseUser, familyFeatures: { gamification: true } })

    const response = await GET({} as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toEqual(baseUser)
    expect(body.user).not.toHaveProperty('familyFeatures')
    expect(gamification).not.toHaveBeenCalled()
  })

  it('returns unauthorized when the direct read rejects a stale session generation', async () => {
    findNative.mockResolvedValue(null)

    const response = await GET({} as any)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ user: null, error: 'Unauthorized' })
  })
})
