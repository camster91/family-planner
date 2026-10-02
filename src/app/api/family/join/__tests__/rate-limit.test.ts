// POST /api/family/join is rate limited three ways before the code is read or
// looked up: per account+IP (10/hour), per account whatever the IP (10/hour)
// and per IP whatever the account (30/hour). Brute-force math:
// createFamilyInviteCode in src/lib/family-invite.ts.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => ({ checkRateLimit: jest.fn() }))

import { POST as join } from '../route'
import { GET as lookup } from '../../lookup/route'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { FAMILY_A, bodyOf, db, fakePrisma, req, type UserKey } from '@/__tests__/helpers/two-household'

const mockCheckRateLimit = checkRateLimit as jest.Mock
const HOUR = 60 * 60 * 1000

// A counting limiter with the real contract: the (max+1)th call in a window is refused.
let counts: Map<string, number>
function countingLimiter(key: string, max: number) {
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return Promise.resolve(
    n > max ? { allowed: false, retryAfterMs: 1_800_000, remaining: 0 } : { allowed: true, retryAfterMs: 0, remaining: max - n }
  )
}

function attempt(as: UserKey, ip: string, inviteCode = 'zzzzzzzzzzzz') {
  return join(req({ as, method: 'POST', body: { inviteCode }, headers: { 'x-forwarded-for': ip } }))
}

beforeEach(() => {
  db.reset()
  counts = new Map()
  mockCheckRateLimit.mockReset()
  mockCheckRateLimit.mockImplementation(countingLimiter)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('join rate limits', () => {
  it('checks the account+IP, account and IP buckets, each 1 hour', async () => {
    expect((await attempt('loner', '203.0.113.5')).status).toBe(404)
    expect(mockCheckRateLimit.mock.calls).toEqual([
      ['join:loner:203.0.113.5', 10, HOUR],
      ['join-account:loner', 10, HOUR],
      ['join-ip:203.0.113.5', 30, HOUR],
    ])
  })

  it('one account is refused after 10 attempts an hour even when it changes IP every time', async () => {
    for (let i = 1; i <= 10; i++) expect((await attempt('loner', `203.0.113.${i}`)).status).toBe(404)
    const res = await attempt('loner', '198.51.100.200')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1800')
    expect(await bodyOf(res)).toEqual({ error: 'Too many join attempts. Please try again later.' })
  })

  it('one IP is refused after 30 attempts an hour even when it changes account', async () => {
    // Members of a household get 400 from join, but each attempt still counts.
    const accounts: UserKey[] = ['loner', 'parentA', 'teenA', 'childA']
    let sent = 0
    for (const as of accounts) {
      for (let i = 0; i < 8 && sent < 30; i++, sent++) {
        expect((await attempt(as, '203.0.113.77')).status).not.toBe(429)
      }
    }
    expect((await attempt('parentB', '203.0.113.77')).status).toBe(429)
    // Another IP is unaffected.
    expect((await attempt('parentB', '203.0.113.78')).status).not.toBe(429)
  })

  it('a refused attempt never reads the code or touches the household', async () => {
    mockCheckRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('join-ip:') ? { allowed: false, retryAfterMs: 5000, remaining: 0 } : { allowed: true, retryAfterMs: 0, remaining: 5 }
    )
    const findFamily = jest.spyOn(fakePrisma.family, 'findUnique')
    const res = await attempt('loner', '203.0.113.9', 'invitea1')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(findFamily).not.toHaveBeenCalled()
    expect(db.find('user', 'loner')!.family_id).toBeNull()
  })

  it('the normal flow (look the code up, then join once) is well under every limit', async () => {
    const ip = '203.0.113.20'
    const headers = { 'x-forwarded-for': ip }
    const found = await lookup(req({ as: 'loner', path: '/api/family/lookup', query: { code: 'INVITEA1' }, headers }))
    expect(found.status).toBe(200)
    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: 'INVITEA1' }, headers }))
    expect(res.status).toBe(200)
    expect(db.find('user', 'loner')!.family_id).toBe(FAMILY_A)
    for (const n of counts.values()) expect(n).toBe(1)
  })
})
