// Sign-in, reset and change-password as a real person types them.
//
// - A phone keyboard capitalises the first letter of the email, and autofill
//   often adds a trailing space. Accounts are stored lower-cased, so both used
//   to fail a correct sign-in ("Invalid email format" / "Invalid email or
//   password").
// - POST /api/auth/reset-password answered 500 for a non-string token or
//   password, and had no rate limit although it is public.
// - POST /api/auth/change-password had no rate limit, so a stolen session
//   cookie was an unlimited current-password oracle.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)

import { db, deviceReq, setCookie, setPassword } from '@/__tests__/helpers/device'
import { POST as login } from '../login/route'
import { POST as resetPassword } from '../reset-password/route'
import { POST as changePassword } from '../change-password/route'

const PASSWORD = 'parent-a-password'

describe('POST /api/auth/login email normalisation', () => {
  beforeEach(() => {
    db.reset()
    setPassword('parentA', PASSWORD)
  })

  it.each(['Parent-A@example.test', ' parent-a@example.test ', 'PARENT-A@EXAMPLE.TEST'])(
    'signs in with %p',
    async (email) => {
      const res = await login(deviceReq({ method: 'POST', path: '/api/auth/login', body: { email, password: PASSWORD } }))
      expect(res.status).toBe(200)
      expect(setCookie(res, 'session_token')!.value).not.toBe('')
    }
  )

  it('a wrong password is still 401', async () => {
    const res = await login(
      deviceReq({ method: 'POST', path: '/api/auth/login', body: { email: 'Parent-A@example.test', password: 'nope' } })
    )
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/reset-password input checks', () => {
  beforeEach(() => db.reset())

  it.each([
    [{ token: { $ne: null }, password: 'long-enough-1' }],
    [{ token: 'abc', password: 12345678 }],
    [{ token: ['abc'], password: 'long-enough-1' }],
    [{}],
  ])('a malformed body %p is 400, not 500', async (body) => {
    const res = await resetPassword(deviceReq({ method: 'POST', path: '/api/auth/reset-password', body, ip: '203.0.113.50' }))
    expect(res.status).toBe(400)
  })

  it('an over-long password is 400', async () => {
    const res = await resetPassword(
      deviceReq({
        method: 'POST',
        path: '/api/auth/reset-password',
        body: { token: 'abc', password: 'x'.repeat(129) },
        ip: '203.0.113.51',
      })
    )
    expect(res.status).toBe(400)
  })

  it('is rate limited per client address', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await resetPassword(
        deviceReq({
          method: 'POST',
          path: '/api/auth/reset-password',
          body: { token: 'no-such-token', password: 'long-enough-1' },
          ip: '203.0.113.52',
        })
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('POST /api/auth/change-password rate limit', () => {
  beforeEach(() => {
    db.reset()
    setPassword('parentA', PASSWORD)
  })

  it('refuses after 10 attempts in the window', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await changePassword(
        deviceReq({
          method: 'POST',
          as: 'parentA',
          path: '/api/auth/change-password',
          body: { currentPassword: 'wrong-guess', newPassword: 'new-password-1' },
        })
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
