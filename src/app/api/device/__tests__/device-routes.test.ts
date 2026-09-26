// Device routes (#240): SHARED_DEVICE.md §12.3 with the §14.2 two-household /
// two-device negatives, §14.3 revocation and §14.5 elevation cases.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { FOREIGN, params } from '@/__tests__/helpers/two-household'
import {
  D1,
  D1B,
  D2,
  H1_CANARIES,
  FAMILY_A,
  advance,
  clearsDeviceCookies,
  db,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  errorCode,
  nextCookies,
  resetClock,
  seedDevice,
  seedDevices,
  setCookie,
  setNow,
  setPassword,
  setPin,
} from '@/__tests__/helpers/device'
import { consumeResetToken, hashToken } from '@/lib/tokens'
import * as me from '../me/route'
import * as today from '../today/route'
import * as refresh from '../session/refresh/route'
import * as elevation from '../elevation/route'
import * as revokeSelf from '../revoke-self/route'
import * as label from '../label/route'
import * as parentRevoke from '../../family/devices/[id]/revoke/route'

const T0 = new Date('2026-09-26T12:00:00Z')
const PIN = '482913'

function rateCount(key: string): number {
  return db.rows('rateLimitEntry').find((r) => r.key === key)?.count ?? 0
}

describe('device routes', () => {
  let fx: ReturnType<typeof seedDevices>

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
    fx = seedDevices()
    setPassword('parentA', 'parent-a-password')
    setPassword('teenA', 'teen-a-password')
    setPassword('childA', 'child-a-password')
    setPassword('parentB', 'parent-b-password')
    setPin('parentA', PIN)
    setPin('parentB', '739251')
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  async function elevate(cookies = fx.d1.cookies, userId = 'parent-a', method = 'pin', secret = PIN) {
    return elevation.POST(deviceReq({ method: 'POST', cookies, body: { userId, method, secret } }))
  }

  async function elevationToken(cookies = fx.d1.cookies): Promise<string> {
    const res = await elevate(cookies)
    expect(res.status).toBe(200)
    return (await res.json()).elevationToken
  }

  describe('GET /api/device/today and /api/device/me', () => {
    // §14.2 item 5
    it('D1 reads only H1 data, with device-audience links and no private fields', async () => {
      const res = await today.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      const text = JSON.stringify(body)
      expect(text).not.toContain(FOREIGN)
      expect(body.links).toEqual({ calendar: null, chores: null, meals: null, lists: null, features: null })
      expect(body.members.map((m: any) => m.id).sort()).toEqual(['child-a', 'parent-a', 'teen-a'])
      for (const m of body.members) expect(Object.keys(m).sort()).toEqual(['id', 'name'])
      for (const banned of ['@example.test', 'Home clinic', 'xp', 'streak', 'avatar_url', 'password', 'price', 'notes']) {
        expect(text).not.toContain(banned)
      }
      expect(body.shopping.items[0]).toMatchObject({ content: 'Home milk' })
    })

    it('D2 reads only H2 data', async () => {
      const text = JSON.stringify(await (await today.GET(deviceReq({ cookies: fx.d2.cookies }))).json())
      for (const canary of H1_CANARIES) expect(text).not.toContain(canary)
      expect(text).toContain(FOREIGN)
    })

    it('shopping follows only the lists feature for a device', async () => {
      db.find('family', FAMILY_A)!.features = { lists: false }
      // lists is a core feature and cannot be disabled; normalizeFeatures keeps it on.
      const body = await (await today.GET(deviceReq({ cookies: fx.d1.cookies }))).json()
      expect(body.links.lists).toBeNull()
    })

    it('me returns the device, household name, 4 feature flags and parents only (names, hasPin)', async () => {
      const res = await me.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({
        device: { id: D1, label: 'Kitchen tablet' },
        household: { name: 'Household A' },
        features: { calendar: true, chores: true, meals: true, lists: true },
        parents: [{ id: 'parent-a', name: 'Parent A', hasPin: true }],
        elevation: { active: false, memberId: null, expiresAt: null },
      })
    })

    it('a PIN row from another household does not count as hasPin', async () => {
      db.rows('parentElevationPin').find((p) => p.user_id === 'parent-a')!.family_id = 'family-B'
      const body = await (await me.GET(deviceReq({ cookies: fx.d1.cookies }))).json()
      expect(body.parents[0].hasPin).toBe(false)
    })

    it('without a device cookie: 401 and no data; a person session is not accepted', async () => {
      const res = await today.GET(deviceReq({ as: 'parentA' }))
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('DEVICE_SESSION_INVALID')
      const onlyRefresh = await me.GET(deviceReq({ cookies: { fp_device_refresh: fx.d1.refresh } }))
      expect(await errorCode(onlyRefresh)).toBe('DEVICE_ACCESS_EXPIRED')
      expect(clearsDeviceCookies(onlyRefresh)).toBe(false)
    })

    it('an expired access cookie is DEVICE_ACCESS_EXPIRED (client refreshes, no purge)', async () => {
      advance(61 * 60 * 1000)
      const res = await me.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('DEVICE_ACCESS_EXPIRED')
    })
  })

  describe('POST /api/device/session/refresh', () => {
    it('rotates both cookies with the contract attributes', async () => {
      const res = await refresh.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      expect(body.accessExpiresAt).toBe(new Date(T0.getTime() + 60 * 60 * 1000).toISOString())
      const access = setCookie(res, 'fp_device')!
      const refreshCookie = setCookie(res, 'fp_device_refresh')!
      expect(access.value).toMatch(/^fpd1_a_/)
      expect(access.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 })
      expect(refreshCookie.value).toMatch(/^fpd1_r_/)
      expect(refreshCookie.options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 2592000 })
      // The new access cookie works; the body never carries tokens.
      expect(JSON.stringify(body)).not.toContain('fpd1_')
      expect((await me.GET(deviceReq({ cookies: nextCookies(res) }))).status).toBe(200)
    })

    it('rejects a missing or unknown refresh cookie and clears both cookies', async () => {
      for (const cookies of [{}, { fp_device_refresh: 'fpd1_r_nope' }]) {
        const res = await refresh.POST(deviceReq({ method: 'POST', cookies }))
        expect(res.status).toBe(401)
        expect(await errorCode(res)).toBe('DEVICE_SESSION_INVALID')
        expect(clearsDeviceCookies(res)).toBe(true)
      }
    })

    // §14.3 item 19 through the route
    it('reuse after the successor was used revokes the device (401 DEVICE_REVOKED, cookies cleared)', async () => {
      const first = await refresh.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies }))
      await me.GET(deviceReq({ cookies: nextCookies(first) }))
      advance(2000)
      const replay = await refresh.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies }))
      expect(replay.status).toBe(401)
      expect(await errorCode(replay)).toBe('DEVICE_REVOKED')
      expect(clearsDeviceCookies(replay)).toBe(true)
      expect(await errorCode(await me.GET(deviceReq({ cookies: nextCookies(first) })))).toBe('DEVICE_REVOKED')
    })

    it('rate-limits refresh per device at 30 per hour with Retry-After', async () => {
      let cookies: Record<string, string | undefined> = fx.d1.cookies
      for (let i = 0; i < 30; i++) {
        const res = await refresh.POST(deviceReq({ method: 'POST', cookies, ip: `203.0.113.${i}` }))
        expect(res.status).toBe(200)
        cookies = nextCookies(res, cookies)
        await me.GET(deviceReq({ cookies }))
      }
      const res = await refresh.POST(deviceReq({ method: 'POST', cookies, ip: '203.0.113.99' }))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    })

    it('rate-limits refresh per IP at 60 per 15 minutes', async () => {
      for (let i = 0; i < 60; i++) {
        expect((await refresh.POST(deviceReq({ method: 'POST', cookies: { fp_device_refresh: `fpd1_r_x${i}` } }))).status).toBe(401)
      }
      expect((await refresh.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies }))).status).toBe(429)
    })
  })

  // §14.3 item 20, §14.2 items 8 and 14
  describe('revocation', () => {
    it('after a parent revokes D1, access, refresh and elevation all return 401 DEVICE_REVOKED with cookie clearing', async () => {
      const revoke = await parentRevoke.POST(
        deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'lost' } }),
        params({ id: D1 })
      )
      expect(revoke.status).toBe(200)
      expect((await revoke.json()).device).toMatchObject({ id: D1, status: 'removed', revokeReason: 'lost' })

      for (const res of [
        await me.GET(deviceReq({ cookies: fx.d1.cookies })),
        await refresh.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies })),
        await elevate(fx.d1.cookies),
      ]) {
        expect(res.status).toBe(401)
        expect(await errorCode(res)).toBe('DEVICE_REVOKED')
        expect(clearsDeviceCookies(res)).toBe(true)
      }
      // D1b (same household) and D2 keep working.
      expect((await me.GET(deviceReq({ cookies: fx.d1b.cookies }))).status).toBe(200)
      expect((await me.GET(deviceReq({ cookies: fx.d2.cookies }))).status).toBe(200)
    })

    it('P2 cannot revoke D1 (404) and D1 keeps working', async () => {
      const res = await parentRevoke.POST(deviceReq({ method: 'POST', as: 'parentB', body: {} }), params({ id: D1 }))
      expect(res.status).toBe(404)
      expect((await me.GET(deviceReq({ cookies: fx.d1.cookies }))).status).toBe(200)
    })
  })

  describe('POST /api/device/elevation', () => {
    it('a parent with the right PIN gets a memory-only token; no person session is issued', async () => {
      const res = await elevate()
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      expect(body).toEqual({
        elevationToken: expect.stringMatching(/^fpd1_e_/),
        expiresAt: new Date(T0.getTime() + 15 * 60 * 1000).toISOString(),
        idleTimeoutSeconds: 300,
        member: { id: 'parent-a', name: 'Parent A' },
      })
      // §14.5 item 38: never a session_token (or any cookie).
      expect((res as any).setCookies).toEqual([])
      expect(db.find('householdDevice', D1)!.elevation_token_hash).toBe(hashToken(body.elevationToken))
      expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({
        type: 'device.elevation_started',
        actor_user_id: 'parent-a',
        metadata: { method: 'pin' },
      })
      const meBody = await (await me.GET(deviceReq({ cookies: fx.d1.cookies }))).json()
      expect(meBody.elevation).toMatchObject({ active: true, memberId: 'parent-a' })
    })

    it('the password fallback works for a parent', async () => {
      const res = await elevate(fx.d1.cookies, 'parent-a', 'password', 'parent-a-password')
      expect(res.status).toBe(200)
    })

    // §14.2 item 11
    it("P2's id with P2's correct PIN or password on D1 is the uniform 401, and counts toward D1's limits only", async () => {
      for (const [method, secret] of [
        ['pin', '739251'],
        ['password', 'parent-b-password'],
      ]) {
        const res = await elevate(fx.d1.cookies, 'parent-b', method, secret)
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({
          error: { code: 'ELEVATION_INVALID_CREDENTIAL', message: 'That did not work.', retryable: false },
        })
      }
      expect(rateCount(`device-elev-fail:${D1}:parent-b`)).toBe(2)
      expect(rateCount(`device-elev-fail:${D1}`)).toBe(2)
      // A foreign tablet cannot lock out P2's account.
      expect(rateCount('device-elev-fail-acct:parent-b')).toBe(0)
      expect(rateCount('login-fail:parent-b@example.test')).toBe(0)
      expect(db.find('householdDevice', D1)!.elevation_token_hash).toBeNull()
    })

    // §14.2 item 12
    it.each([
      ['teenA', 'teen-a', 'teen-a-password'],
      ['childA', 'child-a', 'child-a-password'],
    ])('%s with a correct password gets the same 401', async (_k, id, pw) => {
      const res = await elevate(fx.d1.cookies, id, 'password', pw)
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('ELEVATION_INVALID_CREDENTIAL')
    })

    it('an unknown user id and a wrong PIN get the same 401', async () => {
      expect(await errorCode(await elevate(fx.d1.cookies, 'nobody', 'pin', PIN))).toBe('ELEVATION_INVALID_CREDENTIAL')
      expect(await errorCode(await elevate(fx.d1.cookies, 'parent-a', 'pin', '000001'))).toBe(
        'ELEVATION_INVALID_CREDENTIAL'
      )
    })

    // §14.2 item 15
    it("a parent moved to H2 cannot use their H1 PIN on D1 or D2; the stale PIN row is removed", async () => {
      const token = await elevationToken()
      db.find('user', 'parent-a')!.family_id = 'family-B'
      const res = await label.PATCH(
        deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token }, body: { label: 'x' } })
      )
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('ELEVATION_EXPIRED')
      expect(await errorCode(await elevate(fx.d1.cookies))).toBe('ELEVATION_INVALID_CREDENTIAL')
      expect(await errorCode(await elevate(fx.d2.cookies))).toBe('ELEVATION_INVALID_CREDENTIAL')
      expect(db.rows('parentElevationPin').find((p) => p.user_id === 'parent-a')).toBeUndefined()
    })

    // §14.5 item 37
    it('locks out after 5 failures per parent per tablet (429 with Retry-After)', async () => {
      for (let i = 0; i < 5; i++) expect((await elevate(fx.d1.cookies, 'parent-a', 'pin', '111119')).status).toBe(401)
      const blocked = await elevate()
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
      expect(db.rows('deviceAuditEvent').some((e) => e.type === 'device.elevation_locked' && e.metadata.scope === 'device')).toBe(true)
      // Another tablet is not affected by that per-tablet counter.
      expect((await elevate(fx.d1b.cookies)).status).toBe(200)
    })

    it('locks out after 10 failures per tablet, any user', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await elevate(fx.d1.cookies, `nobody-${i % 2}`, 'pin', '111119')).status).toBe(401)
      }
      expect((await elevate()).status).toBe(429)
    })

    it('locks the PIN account-wide after 10 failures across tablets; the password fallback still works and shares login-fail', async () => {
      const d1c = seedDevice('device-d1c', FAMILY_A, 'Den tablet')
      for (let i = 0; i < 5; i++) await elevate(fx.d1.cookies, 'parent-a', 'pin', '111119')
      for (let i = 0; i < 5; i++) await elevate(fx.d1b.cookies, 'parent-a', 'pin', '111119')
      const pinRow = db.rows('parentElevationPin').find((p) => p.user_id === 'parent-a')!
      expect(pinRow.locked_until).toEqual(new Date(T0.getTime() + 60 * 60 * 1000))
      expect(db.rows('deviceAuditEvent').some((e) => e.type === 'device.elevation_locked' && e.metadata.scope === 'account')).toBe(true)

      const locked = await elevate(d1c.cookies)
      expect(locked.status).toBe(423)
      expect(await errorCode(locked)).toBe('ELEVATION_LOCKED')

      expect((await elevate(d1c.cookies, 'parent-a', 'password', 'wrong-password')).status).toBe(401)
      expect(rateCount('login-fail:parent-a@example.test')).toBe(1)
      expect((await elevate(d1c.cookies, 'parent-a', 'password', 'parent-a-password')).status).toBe(200)
    })

    it('password elevation is refused while the shared login account key is locked', async () => {
      db.rows('rateLimitEntry').push({
        id: 'rl-1',
        key: 'login-fail:parent-a@example.test',
        count: 10,
        windowStart: new Date(),
        resetAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      const res = await elevate(fx.d1.cookies, 'parent-a', 'password', 'parent-a-password')
      expect(res.status).toBe(429)
    })

    // §14.5 item 33 (reset)
    it('a password reset deletes the PIN and ends an active elevation', async () => {
      const token = await elevationToken()
      const parent = db.find('user', 'parent-a')!
      parent.reset_token = hashToken('reset-plain')
      parent.reset_token_expires = new Date(Date.now() + 60 * 60 * 1000)
      expect(await consumeResetToken('reset-plain', 'new-hash')).toBe(true)
      expect(db.rows('parentElevationPin').find((p) => p.user_id === 'parent-a')).toBeUndefined()
      expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ type: 'parent_pin.cleared_by_reset' })
      const res = await revokeSelf.POST(
        deviceReq({ method: 'POST', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token } })
      )
      expect(await errorCode(res)).toBe('ELEVATION_EXPIRED')
      expect(await errorCode(await elevate())).toBe('ELEVATION_INVALID_CREDENTIAL')
    })

    it('rejects a malformed body with 400', async () => {
      const res = await elevation.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies, body: { userId: 'parent-a' } }))
      expect(res.status).toBe(400)
    })
  })

  describe('elevated routes', () => {
    it('label and revoke-self need an elevation token (403 ELEVATION_REQUIRED)', async () => {
      const rename = await label.PATCH(deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, body: { label: 'New' } }))
      expect(rename.status).toBe(403)
      expect(await errorCode(rename)).toBe('ELEVATION_REQUIRED')
      const revoke = await revokeSelf.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies }))
      expect(await errorCode(revoke)).toBe('ELEVATION_REQUIRED')
      expect(db.find('householdDevice', D1)!.revoked_at).toBeNull()
    })

    // §14.2 item 13
    it("D1's elevation token is rejected with D1b's and D2's cookies", async () => {
      const token = await elevationToken()
      for (const cookies of [fx.d1b.cookies, fx.d2.cookies]) {
        const res = await label.PATCH(
          deviceReq({ method: 'PATCH', cookies, headers: { 'x-device-elevation': token }, body: { label: 'Stolen' } })
        )
        expect(res.status).toBe(403)
        expect(await errorCode(res)).toBe('ELEVATION_REQUIRED')
      }
      expect(db.find('householdDevice', D1B)!.label).toBe('Hall tablet')
      expect(db.find('householdDevice', D2)!.label).toContain(FOREIGN)
    })

    it('an elevated parent renames this tablet', async () => {
      const token = await elevationToken()
      const res = await label.PATCH(
        deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token }, body: { label: '  Fridge  ' } })
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ device: { id: D1, label: 'Fridge' } })
      expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({
        type: 'device.elevated_action',
        actor_user_id: 'parent-a',
        metadata: { action: 'rename_device', targetType: 'device', targetId: D1 },
      })
    })

    // §14.5 item 32 through a route
    it('an idle elevation is ELEVATION_EXPIRED', async () => {
      const token = await elevationToken()
      advance(5 * 60 * 1000)
      const res = await label.PATCH(
        deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token }, body: { label: 'x' } })
      )
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('ELEVATION_EXPIRED')
    })

    // §14.5 item 33 (logout / password change) and 34 (demotion)
    it.each([
      ['token_version bump', (u: any) => (u.token_version += 1)],
      ['demotion to teen', (u: any) => (u.role = 'teen')],
    ])('%s ends elevation on the next elevated request', async (_l, mutate) => {
      const token = await elevationToken()
      mutate(db.find('user', 'parent-a'))
      const res = await revokeSelf.POST(
        deviceReq({ method: 'POST', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token } })
      )
      expect(await errorCode(res)).toBe('ELEVATION_EXPIRED')
      expect(db.find('householdDevice', D1)!.revoked_at).toBeNull()
    })

    it('an elevated parent removes this tablet: device revoked, cookies cleared, other devices fine', async () => {
      const token = await elevationToken()
      const res = await revokeSelf.POST(
        deviceReq({ method: 'POST', cookies: fx.d1.cookies, headers: { 'x-device-elevation': token } })
      )
      expect(res.status).toBe(200)
      expect(clearsDeviceCookies(res)).toBe(true)
      expect(db.find('householdDevice', D1)).toMatchObject({ revoked_by: 'parent-a', revoke_reason: 'parent', elevation_token_hash: null })
      expect(await errorCode(await me.GET(deviceReq({ cookies: fx.d1.cookies })))).toBe('DEVICE_REVOKED')
      expect((await me.GET(deviceReq({ cookies: fx.d1b.cookies }))).status).toBe(200)
    })

    it('DELETE /api/device/elevation ends it and is idempotent', async () => {
      const token = await elevationToken()
      const headers = { 'x-device-elevation': token }
      expect((await elevation.DELETE(deviceReq({ method: 'DELETE', cookies: fx.d1.cookies, headers }))).status).toBe(204)
      expect(db.find('householdDevice', D1)!.elevation_token_hash).toBeNull()
      expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ type: 'device.elevation_ended', metadata: { reason: 'exit' } })
      expect((await elevation.DELETE(deviceReq({ method: 'DELETE', cookies: fx.d1.cookies, headers }))).status).toBe(204)
      expect((await elevation.DELETE(deviceReq({ method: 'DELETE', cookies: {} }))).status).toBe(401)
    })
  })

  // §14.6 item 42 (device routes; the full walk is in the allowlist test)
  it('kill switch off: every device route is 404 even with a valid device cookie', async () => {
    disableSharedDevice()
    const cookies = fx.d1.cookies
    for (const res of [
      await me.GET(deviceReq({ cookies })),
      await today.GET(deviceReq({ cookies })),
      await refresh.POST(deviceReq({ method: 'POST', cookies })),
      await elevate(),
      await elevation.DELETE(deviceReq({ method: 'DELETE', cookies })),
      await revokeSelf.POST(deviceReq({ method: 'POST', cookies })),
      await label.PATCH(deviceReq({ method: 'PATCH', cookies, body: { label: 'x' } })),
    ]) {
      expect(res.status).toBe(404)
    }
    expect(db.find('householdDevice', D1)!.last_seen_at).toBeNull()
  })
})
