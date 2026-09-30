// Shared-device credentials (#240): SHARED_DEVICE.md §4, §6, §8 and the
// §14.3 token/rotation/revocation cases, against the two-household fake DB.

jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { fakePrisma } from '@/__tests__/helpers/two-household'
import { D1, D1B, D2, advance, db, now, resetClock, seedDevices, setNow, FAMILY_A } from '@/__tests__/helpers/device'
import { hashToken } from '@/lib/tokens'
import {
  ELEVATION_IDLE_MS,
  ELEVATION_MAX_MS,
  REFRESH_TTL_MS,
  elevationState,
  generateDeviceToken,
  hasLiveDeviceCredential,
  refreshDeviceSession,
  resolveDeviceAccess,
  resolveElevation,
  revokeDevice,
  startElevation,
} from '@/lib/device-session'

const T0 = new Date('2026-09-26T12:00:00Z')

function sessionsOf(deviceId: string) {
  return db.rows('deviceSession').filter((s) => s.device_id === deviceId)
}

function auditTypes(deviceId?: string) {
  return db
    .rows('deviceAuditEvent')
    .filter((e) => !deviceId || e.device_id === deviceId)
    .map((e) => e.type)
}

describe('device tokens', () => {
  it('have the versioned fpd1_ prefix and 256 random bits', () => {
    for (const kind of ['a', 'r', 'e', 'p'] as const) {
      const token = generateDeviceToken(kind)
      expect(token).toMatch(new RegExp(`^fpd1_${kind}_[A-Za-z0-9_-]{43}$`))
      expect(generateDeviceToken(kind)).not.toBe(token)
    }
  })
})

describe('device session resolution and rotation', () => {
  let fx: ReturnType<typeof seedDevices>

  beforeEach(() => {
    db.reset()
    setNow(T0)
    fx = seedDevices()
  })
  afterAll(() => resetClock())

  it('resolves a valid access cookie to a device actor of its own household only', async () => {
    const result = await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())
    expect(result).toMatchObject({ ok: true, actor: { kind: 'device', deviceId: D1, familyId: FAMILY_A } })
    // First use is recorded (the grace rule depends on it) and last_seen moves.
    expect(sessionsOf(D1)[0].first_used_at).toEqual(T0)
    expect(db.find('householdDevice', D1)!.last_seen_at).toEqual(T0)
  })

  it('throttles last_seen_at to one write per 5 minutes', async () => {
    await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())
    advance(60 * 1000)
    await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())
    expect(db.find('householdDevice', D1)!.last_seen_at).toEqual(T0)
    advance(5 * 60 * 1000)
    await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())
    expect(db.find('householdDevice', D1)!.last_seen_at).toEqual(now())
  })

  it('rejects missing, unknown, expired, revoked and cross-family sessions with the right code', async () => {
    expect(await resolveDeviceAccess(fakePrisma, {}, now())).toMatchObject({ ok: false, code: 'DEVICE_SESSION_INVALID' })
    expect(await resolveDeviceAccess(fakePrisma, { refresh: fx.d1.refresh }, now())).toMatchObject({
      ok: false,
      code: 'DEVICE_ACCESS_EXPIRED',
    })
    expect(await resolveDeviceAccess(fakePrisma, { access: 'fpd1_a_unknown' }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
    // A refresh token presented as an access token is not an access token.
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1.refresh }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })

    advance(60 * 60 * 1000)
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())).toMatchObject({
      code: 'DEVICE_ACCESS_EXPIRED',
    })

    // Denormalised family must equal the device's.
    sessionsOf(D1B)[0].family_id = 'family-B'
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1b.access }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
  })

  it('fails closed with 503 (not a purge code) when the database errors', async () => {
    const broken: any = {
      deviceSession: {
        findUnique: async () => {
          throw new Error('db down')
        },
      },
    }
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await resolveDeviceAccess(broken, { access: fx.d1.access }, now())).toEqual({
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
    quiet.mockRestore()
  })

  // §14.3 item 17
  it('refresh issues a new generation; the old access token is then rejected', async () => {
    const r = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    expect(r).toMatchObject({ ok: true, path: 'rotated', deviceId: D1 })
    if (!r.ok) throw new Error('refresh failed')
    expect(r.tokens.accessToken).toMatch(/^fpd1_a_/)
    expect(r.tokens.refreshToken).toMatch(/^fpd1_r_/)
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())).toMatchObject({
      code: 'DEVICE_ACCESS_EXPIRED',
    })
    expect(await resolveDeviceAccess(fakePrisma, { access: r.tokens.accessToken }, now())).toMatchObject({ ok: true })
    const [old, next] = sessionsOf(D1)
    expect(old.rotated_at).toEqual(T0)
    expect(old.replaced_by_id).toBe(next.id)
    // §14.3 item 16: only hashes at rest.
    expect(next.access_token_hash).toBe(hashToken(r.tokens.accessToken))
    expect(JSON.stringify(db.rows('deviceSession'))).not.toContain('fpd1_')
  })

  // §14.3 item 18 (inside the grace window)
  it('a replay within 60 s with an unused successor re-issues and keeps the device', async () => {
    const first = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    advance(30 * 1000)
    const again = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    expect(again).toMatchObject({ ok: true, path: 'grace_reissued' })
    if (!first.ok || !again.ok) throw new Error('refresh failed')
    // The lost successor is dead; the new one works; the device is active.
    expect(await resolveDeviceAccess(fakePrisma, { access: first.tokens.accessToken }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
    expect(await resolveDeviceAccess(fakePrisma, { access: again.tokens.accessToken }, now())).toMatchObject({ ok: true })
    expect(db.find('householdDevice', D1)!.revoked_at).toBeNull()
  })

  // §14.3 item 18 (after the grace window, fake clock)
  it('the same replay after 60 s revokes the device as token reuse', async () => {
    await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    advance(61 * 1000)
    const replay = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    expect(replay).toMatchObject({ ok: false, code: 'DEVICE_REVOKED', reuseDetected: true })
    const device = db.find('householdDevice', D1)!
    expect(device.revoke_reason).toBe('token_reuse')
    expect(device.revoked_by).toBeNull()
    expect(auditTypes(D1)).toEqual(expect.arrayContaining(['device.token_reuse_detected', 'device.revoked']))
  })

  // §14.3 item 19
  it('a replay after the successor was used revokes the device; old and successor tokens both die', async () => {
    const first = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    if (!first.ok) throw new Error('refresh failed')
    await resolveDeviceAccess(fakePrisma, { access: first.tokens.accessToken }, now())
    advance(5 * 1000)
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({
      ok: false,
      code: 'DEVICE_REVOKED',
    })
    expect(await refreshDeviceSession(fakePrisma, first.tokens.refreshToken, now())).toMatchObject({
      code: 'DEVICE_REVOKED',
    })
    expect(await resolveDeviceAccess(fakePrisma, { access: first.tokens.accessToken }, now())).toMatchObject({
      code: 'DEVICE_REVOKED',
    })
    expect(auditTypes(D1)).toContain('device.token_reuse_detected')
    // Other devices are untouched (§14.2 item 14).
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1b.access }, now())).toMatchObject({ ok: true })
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d2.access }, now())).toMatchObject({ ok: true })
  })

  it('the grace window is bounded by the first rotation, not extended by re-issues', async () => {
    await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    advance(40 * 1000)
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({ ok: true })
    advance(40 * 1000)
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({
      ok: false,
      code: 'DEVICE_REVOKED',
    })
  })

  // §14.3 item 21
  it('refresh after 30 days idle is DEVICE_SESSION_INVALID and the device is not revoked', async () => {
    advance(REFRESH_TTL_MS + 1000)
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({
      ok: false,
      code: 'DEVICE_SESSION_INVALID',
    })
    expect(db.find('householdDevice', D1)!.revoked_at).toBeNull()
  })

  it('each rotation restarts the 30-day idle window', async () => {
    advance(REFRESH_TTL_MS - 1000)
    const r = await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())
    if (!r.ok) throw new Error('refresh failed')
    advance(REFRESH_TTL_MS - 1000)
    expect(await refreshDeviceSession(fakePrisma, r.tokens.refreshToken, now())).toMatchObject({ ok: true })
  })

  it('prunes rotated generations older than 7 days on refresh', async () => {
    let refresh = fx.d1.refresh
    for (let i = 0; i < 3; i++) {
      const r = await refreshDeviceSession(fakePrisma, refresh, now())
      if (!r.ok) throw new Error('refresh failed')
      refresh = r.tokens.refreshToken
      advance(4 * 24 * 60 * 60 * 1000)
    }
    await refreshDeviceSession(fakePrisma, refresh, now())
    // Rotated rows older than 7 days are gone; recent ones and the live one remain.
    const rotated = sessionsOf(D1).filter((s) => s.rotated_at)
    // Five generations were created; the two oldest rotated ones are gone.
    expect(sessionsOf(D1)).toHaveLength(3)
    expect(rotated).toHaveLength(2)
    for (const s of rotated) expect(now().getTime() - s.rotated_at.getTime()).toBeLessThan(7 * 24 * 60 * 60 * 1000)
  })

  // §14.3 item 20 (library level)
  it('revocation is idempotent, revokes every generation, and blocks access and refresh', async () => {
    expect(await revokeDevice(fakePrisma, { deviceId: D1, familyId: FAMILY_A, revokedBy: 'parent-a', reason: 'lost', now: now() })).toBe(true)
    expect(await revokeDevice(fakePrisma, { deviceId: D1, familyId: FAMILY_A, revokedBy: 'parent-a', reason: 'lost', now: now() })).toBe(false)
    expect(sessionsOf(D1).every((s) => s.revoked_at)).toBe(true)
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())).toMatchObject({ code: 'DEVICE_REVOKED' })
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({ code: 'DEVICE_REVOKED' })
    expect(auditTypes(D1).filter((t) => t === 'device.revoked')).toHaveLength(1)
    // A foreign household cannot revoke D2 through this helper.
    expect(await revokeDevice(fakePrisma, { deviceId: D2, familyId: FAMILY_A, revokedBy: 'parent-a', reason: 'parent', now: now() })).toBe(false)
    expect(db.find('householdDevice', D2)!.revoked_at).toBeNull()
  })

  // §14.3 item 22: family deletion cascades the device rows away.
  it('after family deletion the device gets DEVICE_SESSION_INVALID', async () => {
    db.tables.householdDevice = db.rows('householdDevice').filter((d) => d.family_id !== FAMILY_A)
    db.tables.deviceSession = db.rows('deviceSession').filter((s) => s.family_id !== FAMILY_A)
    expect(await resolveDeviceAccess(fakePrisma, { access: fx.d1.access }, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
    expect(await refreshDeviceSession(fakePrisma, fx.d1.refresh, now())).toMatchObject({
      code: 'DEVICE_SESSION_INVALID',
    })
  })

  it('login guard sees a valid access cookie or a live refresh cookie, not a revoked one', async () => {
    expect(await hasLiveDeviceCredential(fakePrisma, { access: fx.d1.access }, now())).toBe(true)
    advance(2 * 60 * 60 * 1000) // access expired
    expect(await hasLiveDeviceCredential(fakePrisma, { access: fx.d1.access }, now())).toBe(false)
    expect(await hasLiveDeviceCredential(fakePrisma, { access: fx.d1.access, refresh: fx.d1.refresh }, now())).toBe(true)
    // Guard lookups never rotate.
    expect(sessionsOf(D1)).toHaveLength(1)
    await revokeDevice(fakePrisma, { deviceId: D1, familyId: FAMILY_A, revokedBy: null, reason: 'parent', now: now() })
    expect(await hasLiveDeviceCredential(fakePrisma, { refresh: fx.d1.refresh }, now())).toBe(false)
    expect(await hasLiveDeviceCredential(fakePrisma, { refresh: 'fpd1_r_unknown' }, now())).toBe(false)
  })
})

describe('elevation', () => {
  let fx: ReturnType<typeof seedDevices>

  beforeEach(() => {
    db.reset()
    setNow(T0)
    fx = seedDevices()
  })
  afterAll(() => resetClock())

  async function elevate(deviceId = D1, parentId = 'parent-a') {
    const started = await startElevation(fakePrisma, { deviceId, parentId, tokenVersion: 0, method: 'pin', now: now() })
    if (!started) throw new Error('elevation failed')
    return started.token
  }

  async function check(access: string, header: string | null) {
    const resolved = await resolveDeviceAccess(fakePrisma, { access }, now())
    if (!resolved.ok) throw new Error(`device not resolved: ${resolved.code}`)
    return resolveElevation(fakePrisma, resolved, header, now())
  }

  it('stores only a hash and resolves to an elevated parent actor bound to this device', async () => {
    const token = await elevate()
    expect(token).toMatch(/^fpd1_e_/)
    expect(JSON.stringify(db.rows('householdDevice'))).not.toContain(token)
    expect(await check(fx.d1.access, token)).toMatchObject({
      ok: true,
      actor: { kind: 'device_elevated_parent', parentId: 'parent-a', deviceId: D1 },
    })
    // §14.2 item 13: useless with another device's cookie, same or other household.
    expect(await check(fx.d1b.access, token)).toMatchObject({ ok: false, code: 'ELEVATION_REQUIRED' })
    expect(await check(fx.d2.access, token)).toMatchObject({ ok: false, code: 'ELEVATION_REQUIRED' })
    expect(await check(fx.d1.access, null)).toMatchObject({ ok: false, code: 'ELEVATION_REQUIRED' })
  })

  // §14.5 item 32
  it('expires after 5 minutes idle and clears the columns', async () => {
    const token = await elevate()
    advance(ELEVATION_IDLE_MS - 1000)
    expect(await check(fx.d1.access, token)).toMatchObject({ ok: true })
    advance(ELEVATION_IDLE_MS)
    expect(await check(fx.d1.access, token)).toMatchObject({ ok: false, status: 403, code: 'ELEVATION_EXPIRED' })
    expect(db.find('householdDevice', D1)!.elevation_token_hash).toBeNull()
    expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ type: 'device.elevation_ended', metadata: { reason: 'idle' } })
  })

  it('expires 15 minutes after start even while in use', async () => {
    const token = await elevate()
    for (let i = 0; i < 3; i++) {
      advance(4 * 60 * 1000)
      expect(await check(fx.d1.access, token)).toMatchObject({ ok: true })
    }
    advance(ELEVATION_MAX_MS - 12 * 60 * 1000)
    expect(await check(fx.d1.access, token)).toMatchObject({ ok: false, code: 'ELEVATION_EXPIRED' })
    expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ metadata: { reason: 'max' } })
  })

  // §14.5 items 33–34, §14.2 item 15
  it.each([
    ['token_version bump (logout, password change or reset)', (u: any) => (u.token_version += 1)],
    ['demotion to teen', (u: any) => (u.role = 'teen')],
    ['moving to another household', (u: any) => (u.family_id = 'family-B')],
  ])('%s ends the elevation', async (_label, mutate) => {
    const token = await elevate()
    mutate(db.find('user', 'parent-a'))
    expect(await check(fx.d1.access, token)).toMatchObject({ ok: false, code: 'ELEVATION_EXPIRED' })
    expect(db.find('householdDevice', D1)!.elevated_user_id).toBeNull()
    expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ metadata: { reason: 'credential_changed' } })
  })

  it('me reports elevation state without the token', async () => {
    await elevate()
    const device = db.find('householdDevice', D1) as any
    expect(elevationState(device, now())).toEqual({
      active: true,
      memberId: 'parent-a',
      expiresAt: new Date(T0.getTime() + ELEVATION_MAX_MS).toISOString(),
    })
    advance(ELEVATION_IDLE_MS)
    expect(elevationState(device, now())).toEqual({ active: false, memberId: null, expiresAt: null })
  })

  it('cannot start on a revoked device', async () => {
    await revokeDevice(fakePrisma, { deviceId: D1, familyId: FAMILY_A, revokedBy: null, reason: 'parent', now: now() })
    expect(await startElevation(fakePrisma, { deviceId: D1, parentId: 'parent-a', tokenVersion: 0, method: 'pin', now: now() })).toBeNull()
  })
})
