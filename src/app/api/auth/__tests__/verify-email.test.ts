// Email confirm step (O-24). Mail scanners open every link in an email, and
// GET /api/auth/verify-email used to consume the token, so the person's own
// click then said "expired or already used". Now:
//   * GET never consumes; it forwards old links to the /verify-email page.
//   * POST { token } consumes it once; a repeat says "already verified".
//   * POST is rate limited per client address.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)

import { db, deviceReq, USER_IDS } from '@/__tests__/helpers/device'
import { hashToken } from '@/lib/tokens'
import { GET, POST } from '../verify-email/route'

const TOKEN = 'a'.repeat(64)
let ipCounter = 0
const nextIp = () => `203.0.113.${100 + (ipCounter++ % 100)}`

function seedUnverified(token = TOKEN, expires = new Date(Date.now() + 60 * 60 * 1000)) {
  const user = db.find('user', USER_IDS.parentA)!
  user.email_verified = false
  user.verify_token = hashToken(token)
  user.verify_token_expires = expires
  return user
}

const post = (body: unknown, ip = nextIp()) =>
  POST(deviceReq({ method: 'POST', path: '/api/auth/verify-email', body, ip }))

describe('GET /api/auth/verify-email (links in already-sent emails)', () => {
  beforeEach(() => db.reset())

  it('forwards to the confirm page without consuming the token', async () => {
    const user = seedUnverified()
    const res = await GET(deviceReq({ path: '/api/auth/verify-email', query: { token: TOKEN } }))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/verify-email')
    expect(location.searchParams.get('token')).toBe(TOKEN)
    expect(user.email_verified).toBe(false)
    expect(user.verify_token).toBe(hashToken(TOKEN))
    expect(user.verify_token_expires).toBeInstanceOf(Date)
  })

  it('a link without a token goes to sign-in with missing_token', async () => {
    const res = await GET(deviceReq({ path: '/api/auth/verify-email' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login?error=missing_token')
  })
})

describe('POST /api/auth/verify-email (the confirm button)', () => {
  beforeEach(() => db.reset())

  it('verifies the email once, then reports already verified', async () => {
    const user = seedUnverified()

    const first = await post({ token: TOKEN })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ status: 'verified' })
    expect(user.email_verified).toBe(true)
    expect(user.verify_token_expires).toBeNull()

    const second = await post({ token: TOKEN })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ status: 'already_verified' })
  })

  it('an expired token is invalid and verifies nothing', async () => {
    const user = seedUnverified(TOKEN, new Date(Date.now() - 1000))
    const res = await post({ token: TOKEN })
    expect(res.status).toBe(400)
    expect((await res.json()).status).toBe('invalid')
    expect(user.email_verified).toBe(false)
  })

  it('an unknown token is invalid', async () => {
    seedUnverified()
    const res = await post({ token: 'b'.repeat(64) })
    expect(res.status).toBe(400)
    expect((await res.json()).status).toBe('invalid')
  })

  it('submitting the stored hash does not verify', async () => {
    const user = seedUnverified()
    const res = await post({ token: hashToken(TOKEN) })
    expect(res.status).toBe(400)
    expect(user.email_verified).toBe(false)
  })

  it.each([
    ['no token', {}],
    ['a number', { token: 123 }],
    ['an array', { token: ['x'] }],
    ['an empty string', { token: '' }],
    ['an over-long string', { token: 'x'.repeat(257) }],
  ])(
    'a token that is %s is 400',
    async (_label, body) => {
      const res = await post(body)
      expect(res.status).toBe(400)
    }
  )

  it('a missing JSON body is 400', async () => {
    const res = await POST(deviceReq({ method: 'POST', path: '/api/auth/verify-email', ip: nextIp() }))
    expect(res.status).toBe(400)
  })

  it('is rate limited per client address', async () => {
    const ip = '198.51.100.201'
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await post({ token: 'c'.repeat(64) }, ip)).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
