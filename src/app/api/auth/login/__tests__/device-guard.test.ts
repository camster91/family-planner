// POST /api/auth/login on a paired tablet (#240, SHARED_DEVICE.md §4 O-13,
// §14.6 item 40): refused with 409 while a working device credential is
// present; unchanged otherwise, and unchanged while the kill switch is off.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import {
  FAMILY_A,
  advance,
  db,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  errorCode,
  resetClock,
  seedDevice,
  setCookie,
  setNow,
  setPassword,
} from '@/__tests__/helpers/device'
import { POST as login } from '../route'
import { revokeDevice } from '@/lib/device-session'
import { fakePrisma } from '@/__tests__/helpers/two-household'

const T0 = new Date('2026-09-26T12:00:00Z')
const creds = { email: 'parent-a@example.test', password: 'parent-a-password' }

describe('login while a device cookie is present', () => {
  let d1: ReturnType<typeof seedDevice>

  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
    setPassword('parentA', creds.password)
    d1 = seedDevice('device-d1', FAMILY_A)
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  it('a valid device access cookie → 409 DEVICE_MODE_LOGIN_BLOCKED and no session cookie', async () => {
    const res = await login(deviceReq({ method: 'POST', cookies: { fp_device: d1.access }, body: creds }))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('DEVICE_MODE_LOGIN_BLOCKED')
    expect(setCookie(res, 'session_token')).toBeUndefined()
  })

  it('only a live refresh cookie (access expired) → 409, and the refresh token is not rotated', async () => {
    advance(2 * 60 * 60 * 1000)
    const res = await login(deviceReq({ method: 'POST', cookies: d1.cookies, body: creds }))
    expect(res.status).toBe(409)
    expect(db.rows('deviceSession')).toHaveLength(1)
    expect(db.rows('deviceSession')[0].rotated_at).toBeNull()
  })

  it('a revoked refresh cookie, an unknown one, or none → normal login', async () => {
    await revokeDevice(fakePrisma, { deviceId: 'device-d1', familyId: FAMILY_A, revokedBy: null, reason: 'parent', now: T0 })
    for (const cookies of [d1.cookies, { fp_device_refresh: 'fpd1_r_unknown' }, {}]) {
      const res = await login(deviceReq({ method: 'POST', cookies, body: creds }))
      expect(res.status).toBe(200)
      expect(setCookie(res, 'session_token')!.value).not.toBe('')
    }
  })

  it('kill switch off: device cookies are ignored and login is unchanged', async () => {
    disableSharedDevice()
    const res = await login(deviceReq({ method: 'POST', cookies: d1.cookies, body: creds }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.id).toBe('parent-a')
  })

  it('wrong password with no device cookie is still the existing 401', async () => {
    const res = await login(deviceReq({ method: 'POST', body: { ...creds, password: 'nope' } }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid email or password' })
  })
})
