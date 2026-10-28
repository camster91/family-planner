// The backend selector must never mix D1 identity with PostgreSQL records.
const mockGetD1SessionAuthority = jest.fn()
jest.mock('@/lib/cloudflare/session-authority', () => ({
  getD1SessionAuthority: (...args: unknown[]) => mockGetD1SessionAuthority(...args),
}))
jest.mock('@/lib/prisma', () => { throw new Error('PostgreSQL must not load for D1 sessions') })

import { getTokenVersion, isSessionCurrent, resolveSession, verifySessionToken } from '@/lib/session'
import { signToken } from '@/lib/auth'

const originalStorage = process.env.HEREWOVEN_STORAGE
beforeEach(() => {
  process.env.HEREWOVEN_STORAGE = 'd1'
  mockGetD1SessionAuthority.mockReset()
})
afterAll(() => {
  if (originalStorage === undefined) delete process.env.HEREWOVEN_STORAGE
  else process.env.HEREWOVEN_STORAGE = originalStorage
})

const payload = { userId: 'member-a', email: 'a@example.test', role: 'parent', family_id: 'family-a', tv: 2 }

it('replaces stale household and role claims with current D1 authority', async () => {
  mockGetD1SessionAuthority.mockResolvedValue({ token_version: 2, role: 'child', family_id: 'family-b' })
  expect(await resolveSession(payload)).toEqual({ ...payload, role: 'child', family_id: 'family-b' })
  expect(mockGetD1SessionAuthority).toHaveBeenCalledWith('member-a')
})
it('rejects a revoked session', async () => {
  mockGetD1SessionAuthority.mockResolvedValue({ token_version: 3, role: 'parent', family_id: 'family-a' })
  expect(await resolveSession(payload)).toBeNull()
  expect(await isSessionCurrent(payload)).toBe(false)
})
it('rejects a deleted account instead of treating it as generation zero', async () => {
  mockGetD1SessionAuthority.mockResolvedValue(null)
  expect(await getTokenVersion('member-a')).toBeNull()
  expect(await resolveSession({ ...payload, tv: 0 })).toBeNull()
})
it('propagates missing binding/storage failures without a PostgreSQL fallback', async () => {
  mockGetD1SessionAuthority.mockRejectedValue(new Error('D1 unavailable'))
  await expect(resolveSession(payload)).rejects.toThrow('D1 unavailable')
  await expect(getTokenVersion('member-a')).rejects.toThrow('D1 unavailable')
})
it('checks signed tokens against D1 and rejects tampering before reading it', async () => {
  mockGetD1SessionAuthority.mockResolvedValue({ token_version: 2, role: 'teen', family_id: 'family-b' })
  const token = signToken(payload)
  expect(await verifySessionToken(token)).toMatchObject({ role: 'teen', family_id: 'family-b' })
  mockGetD1SessionAuthority.mockClear()
  expect(await verifySessionToken(token + 'x')).toBeNull()
  expect(mockGetD1SessionAuthority).not.toHaveBeenCalled()
})

it('rejects an unknown backend setting without using PostgreSQL', async () => {
  process.env.HEREWOVEN_STORAGE = 'typo'
  await expect(resolveSession(payload)).rejects.toThrow('HEREWOVEN_STORAGE must be postgres or d1')
  expect(mockGetD1SessionAuthority).not.toHaveBeenCalled()
})
