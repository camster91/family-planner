// POST /api/auth/register on a paired tablet (#240, SHARED_DEVICE.md §4 O-13):
// the invite branch issues a person session, so a paired device is refused
// with the same 409 as login; unchanged when no device credential is present
// or the kill switch is off.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/mail', () => ({ sendMail: jest.fn() }))

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
} from '@/__tests__/helpers/device'
import { POST as register } from '../route'
import { revokeDevice } from '@/lib/device-session'
import { fakePrisma } from '@/__tests__/helpers/two-household'

const T0 = new Date('2026-09-26T12:00:00Z')
const body = { name: 'Invitee', email: 'new@invitee.test', password: 'a-long-password-1', inviteToken: 'x'.repeat(43) }

describe('registration while a device cookie is present', () => {
  let d1: ReturnType<typeof seedDevice>

  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
    d1 = seedDevice('device-d1', FAMILY_A)
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  it('a valid device access cookie → 409 DEVICE_MODE_LOGIN_BLOCKED and no session cookie', async () => {
    const res = await register(deviceReq({ method: 'POST', cookies: { fp_device: d1.access }, body }))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('DEVICE_MODE_LOGIN_BLOCKED')
    expect(setCookie(res, 'session_token')).toBeUndefined()
  })

  it('only a live refresh cookie (access expired) → 409', async () => {
    advance(2 * 60 * 60 * 1000)
    const res = await register(deviceReq({ method: 'POST', cookies: d1.cookies, body }))
    expect(res.status).toBe(409)
  })

  it('a revoked device, no device cookie, or the kill switch off → the guard does not apply', async () => {
    await revokeDevice(fakePrisma, { deviceId: 'device-d1', familyId: FAMILY_A, revokedBy: null, reason: 'parent', now: T0 })
    for (const cookies of [d1.cookies, {}]) {
      const res = await register(deviceReq({ method: 'POST', cookies, body }))
      expect(res.status).not.toBe(409)
    }
    disableSharedDevice()
    const fresh = seedDevice('device-d2', FAMILY_A)
    const res = await register(deviceReq({ method: 'POST', cookies: fresh.cookies, body }))
    expect(res.status).not.toBe(409)
  })
})
