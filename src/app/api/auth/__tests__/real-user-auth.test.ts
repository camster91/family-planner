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
// - POST /api/auth/forgot-password looked up only the lower-cased email, so an
//   older account stored with capitals (which login still accepts) could not
//   reset its password.
// - POST /api/auth/change-password left an outstanding reset link valid, so a
//   link requested earlier could still override the new password.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/notification-delivery', () => ({ sendAccountMail: jest.fn(async () => undefined) }))

import { db, deviceReq, setCookie, setPassword } from '@/__tests__/helpers/device'
import { POST as login } from '../login/route'
import { POST as resetPassword } from '../reset-password/route'
import { POST as changePassword } from '../change-password/route'
import { POST as forgotPassword } from '../forgot-password/route'

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

  // O-37: a teen changes their own password from their own Settings page.
  it('lets a teen change their own password, and only their own', async () => {
    setPassword('teenA', 'teen-a-password')
    const before = db.find('user', 'parent-a')!.password
    const res = await changePassword(
      deviceReq({
        method: 'POST',
        as: 'teenA',
        path: '/api/auth/change-password',
        body: { currentPassword: 'teen-a-password', newPassword: 'teen-new-password' },
      })
    )
    expect(res.status).toBe(200)
    const bcrypt = require('bcryptjs')
    expect(bcrypt.compareSync('teen-new-password', db.find('user', 'teen-a')!.password)).toBe(true)
    expect(db.find('user', 'parent-a')!.password).toBe(before)
  })
})

describe('POST /api/auth/forgot-password email lookup', () => {
  beforeEach(() => db.reset())

  const forgot = (email: string, ip: string) =>
    forgotPassword(deviceReq({ method: 'POST', path: '/api/auth/forgot-password', body: { email }, ip }))

  it('finds a lower-cased account from a capitalised address', async () => {
    const res = await forgot(' Parent-A@Example.test ', '203.0.113.60')
    expect(res.status).toBe(200)
    expect(db.find('user', 'parent-a')!.reset_token).toEqual(expect.any(String))
  })

  it('falls back to the address as typed for a legacy mixed-case account, like login', async () => {
    db.find('user', 'parent-a')!.email = 'Parent-A@Example.test'
    const res = await forgot('Parent-A@Example.test', '203.0.113.61')
    expect(res.status).toBe(200)
    expect(db.find('user', 'parent-a')!.reset_token).toEqual(expect.any(String))
  })

  it('an unknown address still answers 200 and issues nothing', async () => {
    const res = await forgot('Nobody@Example.test', '203.0.113.62')
    expect(res.status).toBe(200)
    expect(db.rows('user').every((u: any) => !u.reset_token)).toBe(true)
  })
})

describe('POST /api/auth/change-password clears an outstanding reset link', () => {
  beforeEach(() => {
    db.reset()
    setPassword('parentA', PASSWORD)
    const user = db.find('user', 'parent-a')!
    user.reset_token = 'hashed-earlier-reset-token'
    user.reset_token_expires = new Date(Date.now() + 30 * 60 * 1000)
  })

  it('a successful change removes the reset token', async () => {
    const res = await changePassword(
      deviceReq({
        method: 'POST',
        as: 'parentA',
        path: '/api/auth/change-password',
        body: { currentPassword: PASSWORD, newPassword: 'new-password-1' },
      })
    )
    expect(res.status).toBe(200)
    expect(db.find('user', 'parent-a')).toMatchObject({ reset_token: null, reset_token_expires: null })
  })

  it('a refused change leaves it alone', async () => {
    const res = await changePassword(
      deviceReq({
        method: 'POST',
        as: 'parentA',
        path: '/api/auth/change-password',
        body: { currentPassword: 'wrong-guess', newPassword: 'new-password-1' },
      })
    )
    expect(res.status).toBe(400)
    expect(db.find('user', 'parent-a')!.reset_token).toBe('hashed-earlier-reset-token')
  })
})
