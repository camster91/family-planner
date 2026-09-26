// Parent device management and pairing (#240): SHARED_DEVICE.md §5, §12.1,
// §12.2 with §14.2 items 8–10, §14.4 and §14.6 item 39.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { FOREIGN, params, type UserKey } from '@/__tests__/helpers/two-household'
import {
  D1,
  FAMILY_A,
  FAMILY_B,
  advance,
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
} from '@/__tests__/helpers/device'
import { hashToken } from '@/lib/tokens'
import * as devices from '../route'
import * as deviceById from '../[id]/route'
import * as deviceRevoke from '../[id]/revoke/route'
import * as deviceEvents from '../[id]/events/route'
import * as pairings from '../pairings/route'
import * as pairingById from '../pairings/[id]/route'
import * as pairingConfirm from '../pairings/[id]/confirm/route'
import * as claim from '../../../device/pair/claim/route'
import * as status from '../../../device/pair/status/route'
import * as me from '../../../device/me/route'
import * as elevationPin from '../../../users/elevation-pin/route'

const T0 = new Date('2026-09-26T12:00:00Z')

async function createPairing(as: UserKey = 'parentA', label = 'Kitchen tablet') {
  const res = await pairings.POST(deviceReq({ method: 'POST', as, body: { label } }))
  return { res, body: await res.json() }
}

async function claimCode(code: string, body: Record<string, unknown> = {}, ip?: string) {
  const res = await claim.POST(deviceReq({ method: 'POST', ip, body: { code, platform: 'android', appVersion: '1.0', ...body } }))
  return { res, body: await res.json() }
}

async function pollStatus(claimToken: string, cookies: Record<string, string> = {}) {
  return status.POST(deviceReq({ method: 'POST', cookies, body: { claimToken } }))
}

async function confirm(pairingId: string, digits: string, as: UserKey = 'parentA') {
  return pairingConfirm.POST(deviceReq({ method: 'POST', as, body: { digits } }), params({ id: pairingId }))
}

/** Parent creates, tablet claims, parent confirms. Returns the claim token. */
async function pairUpTo(stage: 'claimed' | 'confirmed', as: UserKey = 'parentA') {
  const created = await createPairing(as)
  const claimed = await claimCode(created.body.code)
  if (stage === 'confirmed') expect((await confirm(created.body.pairingId, claimed.body.confirmDigits, as)).status).toBe(200)
  return { pairingId: created.body.pairingId as string, claimToken: claimed.body.claimToken as string, digits: claimed.body.confirmDigits as string }
}

function wrongDigits(d: string) {
  return d === '0000' ? '0001' : '0000'
}

describe('shared-device pairing and management', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    enableSharedDevice()
    setNow(T0)
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  describe('full pairing flow', () => {
    it('create → claim → confirm → issue: device cookies set, session_token cleared, parent sessions untouched', async () => {
      const created = await createPairing()
      expect(created.res.status).toBe(201)
      expect(created.res.headers.get('Cache-Control')).toBe('private, no-store')
      expect(created.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      expect(created.body.expiresAt).toBe(new Date(T0.getTime() + 10 * 60 * 1000).toISOString())
      const pairingId = created.body.pairingId

      // Parent sees "waiting"; the code is never returned again or stored in plaintext.
      const waiting = await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: pairingId }))
      expect(await waiting.json()).toEqual({ status: 'waiting' })
      const rawCode = created.body.code.replace('-', '')
      expect(db.find('devicePairing', pairingId)!.code_hash).toBe(hashToken(rawCode))
      expect(JSON.stringify(db.rows('devicePairing'))).not.toContain(rawCode)

      // Tablet claims with a sloppy, lowercase, spaced version of the code.
      const sloppy = ` ${created.body.code.toLowerCase().replace('-', ' ')} `
      const claimed = await claimCode(sloppy)
      expect(claimed.res.status).toBe(200)
      expect(claimed.body).toEqual({
        claimToken: expect.stringMatching(/^fpd1_p_/),
        confirmDigits: expect.stringMatching(/^\d{4}$/),
        expiresAt: created.body.expiresAt,
      })
      const row = db.find('devicePairing', pairingId)!
      expect(row.claim_token_hash).toBe(hashToken(claimed.body.claimToken))
      expect(row.confirm_digits_hash).toBe(hashToken(claimed.body.confirmDigits))
      expect(JSON.stringify(row)).not.toContain(claimed.body.claimToken)

      const claimedView = await (await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: pairingId }))).json()
      expect(claimedView).toEqual({ status: 'claimed', claim: { platform: 'android', appVersion: '1.0' } })
      expect(JSON.stringify(claimedView)).not.toContain(claimed.body.confirmDigits)

      const pending = await pollStatus(claimed.body.claimToken)
      expect(await pending.json()).toEqual({ status: 'pending' })

      // One wrong attempt, then the right digits.
      const wrong = await confirm(pairingId, wrongDigits(claimed.body.confirmDigits))
      expect(wrong.status).toBe(400)
      expect((await wrong.json()).error).toMatchObject({ code: 'PAIRING_DIGITS_MISMATCH', attemptsLeft: 2 })
      const ok = await confirm(pairingId, claimed.body.confirmDigits)
      expect(await ok.json()).toEqual({ status: 'confirmed' })

      // §14.6 item 39: the tablet had a parent session; pairing clears it and
      // does not bump the parent's token_version.
      const tvBefore = db.find('user', 'parent-a')!.token_version
      const paired = await pollStatus(claimed.body.claimToken, { session_token: 'session:parent-a' })
      expect(paired.status).toBe(200)
      const pairedBody = await paired.json()
      expect(pairedBody).toEqual({ status: 'paired', device: { id: expect.any(String), label: 'Kitchen tablet' } })
      expect(setCookie(paired, 'fp_device')!.value).toMatch(/^fpd1_a_/)
      expect(setCookie(paired, 'fp_device_refresh')!.value).toMatch(/^fpd1_r_/)
      expect(setCookie(paired, 'session_token')).toMatchObject({ value: '', options: { maxAge: 0 } })
      expect(db.find('user', 'parent-a')!.token_version).toBe(tvBefore)

      const device = db.find('householdDevice', pairedBody.device.id)!
      expect(device).toMatchObject({ family_id: FAMILY_A, created_by: 'parent-a', confirmed_by: 'parent-a', platform: 'android' })
      // The new cookies work against the device API.
      expect((await me.GET(deviceReq({ cookies: nextCookies(paired) as any }))).status).toBe(200)

      // §14.4 item 29: a second status call cannot mint a second device.
      const again = await pollStatus(claimed.body.claimToken)
      expect(again.status).toBe(410)
      expect(await errorCode(again)).toBe('PAIRING_EXPIRED')
      expect(db.rows('householdDevice')).toHaveLength(1)

      // Audit trail, fixed vocabulary, no secrets.
      const types = db.rows('deviceAuditEvent').map((e) => e.type)
      expect(types).toEqual([
        'device.pairing_created',
        'device.pairing_claimed',
        'device.pairing_confirmed',
        'device.paired',
      ])
      const auditText = JSON.stringify(db.rows('deviceAuditEvent'))
      expect(auditText).not.toContain(`"${claimed.body.confirmDigits}"`)
      expect(auditText).not.toContain('fpd1_')
      expect(auditText).not.toContain(rawCode)

      // §14.3 item 16: no plaintext token anywhere in the device tables.
      for (const table of ['householdDevice', 'deviceSession', 'devicePairing', 'deviceAuditEvent']) {
        expect(JSON.stringify(db.rows(table))).not.toContain('fpd1_')
      }

      // Parent view.
      const list = await (await devices.GET(deviceReq({ as: 'parentA' }))).json()
      expect(list.devices).toEqual([
        expect.objectContaining({ id: device.id, label: 'Kitchen tablet', platform: 'android', status: 'active', appVersion: '1.0' }),
      ])
      const done = await (await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: pairingId }))).json()
      expect(done.status).toBe('paired')
    })

    // §14.2 item 10
    it('a code created by P2 and claimed by a tablet claiming family_id = H1 belongs to H2 only', async () => {
      const created = await createPairing('parentB')
      const claimed = await claimCode(created.body.code, { family_id: FAMILY_A, familyId: FAMILY_A, memberId: 'parent-a' })
      await confirm(created.body.pairingId, claimed.body.confirmDigits, 'parentB')
      const pairedRes = await pollStatus(claimed.body.claimToken)
      const paired = await pairedRes.json()
      expect(db.find('householdDevice', paired.device.id)!.family_id).toBe(FAMILY_B)
      const meBody = await (await me.GET(deviceReq({ cookies: nextCookies(pairedRes) as any }))).json()
      expect(meBody.household.name).toBe(`Household ${FOREIGN}`)
      expect(meBody.parents.map((p: any) => p.id)).toEqual(['parent-b'])
    })
  })

  describe('pairing codes', () => {
    // §14.4 item 26
    it('unknown, expired, used and cancelled codes all return the identical 400 body', async () => {
      const bodies: string[] = []
      bodies.push(JSON.stringify((await claimCode('ZZZZ-ZZZZ')).body))
      bodies.push(JSON.stringify((await claimCode('not a code')).body))

      const used = await createPairing()
      await claimCode(used.body.code)
      bodies.push(JSON.stringify((await claimCode(used.body.code)).body))

      const cancelled = await createPairing()
      await pairingById.DELETE(deviceReq({ method: 'DELETE', as: 'parentA' }), params({ id: cancelled.body.pairingId }))
      bodies.push(JSON.stringify((await claimCode(cancelled.body.code)).body))

      const expired = await createPairing()
      advance(10 * 60 * 1000 + 1)
      bodies.push(JSON.stringify((await claimCode(expired.body.code, {}, '192.0.2.50')).body))

      expect(new Set(bodies).size).toBe(1)
      expect(JSON.parse(bodies[0])).toEqual({
        error: { code: 'PAIRING_CODE_INVALID', message: expect.any(String), retryable: false },
      })
    })

    // §14.4 item 25 (fake DB; the real-Postgres race is in device.integration.test.ts)
    it('a code is single use when two claims arrive together', async () => {
      const created = await createPairing()
      const [a, b] = await Promise.all([claimCode(created.body.code), claimCode(created.body.code)])
      expect([a.res.status, b.res.status].sort()).toEqual([200, 400])
    })

    // §14.4 item 27 (live codes)
    it('a fourth live code cancels the oldest', async () => {
      const first = await createPairing()
      await createPairing()
      await createPairing()
      await createPairing()
      expect(db.find('devicePairing', first.body.pairingId)!.cancelled_at).toEqual(T0)
      expect((await claimCode(first.body.code)).res.status).toBe(400)
      const live = db.rows('devicePairing').filter((p) => !p.cancelled_at)
      expect(live).toHaveLength(3)
      expect(db.rows('deviceAuditEvent').filter((e) => e.metadata?.reason === 'superseded')).toHaveLength(1)
    })

    // §14.4 item 27 (capacity)
    it('the sixth active device is refused, and pending pairings reserve capacity', async () => {
      for (let i = 0; i < 5; i++) seedDevice(`dev-${i}`, FAMILY_A)
      const full = await createPairing()
      expect(full.res.status).toBe(409)
      expect(full.body.error.code).toBe('DEVICE_LIMIT_REACHED')

      db.tables.householdDevice = db.rows('householdDevice').slice(0, 4)
      const pending = await createPairing()
      expect(pending.res.status).toBe(201)
      const blocked = await createPairing()
      expect(blocked.res.status).toBe(409)
      // The refused attempt left no side effects (rolled back).
      expect(db.rows('devicePairing').filter((p) => !p.cancelled_at)).toHaveLength(1)
    })

    it('the limit is re-checked at issue: over the limit the pairing is cancelled and the tablet gets 409', async () => {
      const a = await pairUpTo('confirmed')
      const b = await pairUpTo('confirmed')
      for (let i = 0; i < 4; i++) seedDevice(`dev-${i}`, FAMILY_A)
      expect((await pollStatus(a.claimToken)).status).toBe(200)
      const over = await pollStatus(b.claimToken)
      expect(over.status).toBe(409)
      expect(await errorCode(over)).toBe('DEVICE_LIMIT_REACHED')
      expect(db.find('devicePairing', b.pairingId)!.cancelled_at).toEqual(T0)
      expect(await errorCode(await pollStatus(b.claimToken))).toBe('PAIRING_CANCELLED')
      expect(db.rows('householdDevice').filter((d) => d.family_id === FAMILY_A && !d.revoked_at)).toHaveLength(5)
    })

    // §14.4 item 28
    it('three wrong digits cancel the pairing; the tablet then gets 410', async () => {
      const p = await pairUpTo('claimed')
      const wrong = wrongDigits(p.digits)
      const attempts = []
      for (let i = 0; i < 3; i++) attempts.push((await (await confirm(p.pairingId, wrong)).json()).error)
      expect(attempts.map((e) => e.attemptsLeft)).toEqual([2, 1, 0])
      const after = await confirm(p.pairingId, p.digits)
      expect(after.status).toBe(410)
      expect(await errorCode(after)).toBe('PAIRING_CANCELLED')
      const tablet = await pollStatus(p.claimToken)
      expect(tablet.status).toBe(410)
      expect(await errorCode(tablet)).toBe('PAIRING_CANCELLED')
      expect(db.rows('deviceAuditEvent').some((e) => e.metadata?.reason === 'digits_mismatch')).toBe(true)
    })

    it('the parent can cancel ("This isn\'t my tablet"); cancel is idempotent', async () => {
      const p = await pairUpTo('claimed')
      for (let i = 0; i < 2; i++) {
        expect((await pairingById.DELETE(deviceReq({ method: 'DELETE', as: 'parentA' }), params({ id: p.pairingId }))).status).toBe(204)
      }
      expect(await errorCode(await pollStatus(p.claimToken))).toBe('PAIRING_CANCELLED')
      expect(db.rows('deviceAuditEvent').filter((e) => e.metadata?.reason === 'parent')).toHaveLength(1)
    })

    it('confirm before the tablet claims is 409; after expiry 410; claiming does not extend expiry', async () => {
      const created = await createPairing()
      expect(await errorCode(await confirm(created.body.pairingId, '1234'))).toBe('PAIRING_NOT_CLAIMED')
      advance(9 * 60 * 1000)
      const claimed = await claimCode(created.body.code)
      expect(claimed.body.expiresAt).toBe(created.body.expiresAt)
      advance(2 * 60 * 1000)
      expect(await errorCode(await confirm(created.body.pairingId, claimed.body.confirmDigits))).toBe('PAIRING_EXPIRED')
      expect(await errorCode(await pollStatus(claimed.body.claimToken))).toBe('PAIRING_EXPIRED')
      expect((await (await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: created.body.pairingId }))).json()).status).toBe('expired')
    })

    it('an unknown claim token gets 410', async () => {
      expect(await errorCode(await pollStatus('fpd1_p_unknown'))).toBe('PAIRING_EXPIRED')
      expect(await errorCode(await pollStatus(''))).toBe('PAIRING_EXPIRED')
    })

    it('rejects labels outside 1–40 characters', async () => {
      expect((await createPairing('parentA', '')).res.status).toBe(400)
      expect((await createPairing('parentA', 'x'.repeat(41))).res.status).toBe(400)
    })
  })

  // §14.2 items 8 and 9, §14.4 item 30
  describe('household isolation and roles', () => {
    it('P2 cannot see, rename, revoke or read events of D1', async () => {
      const fx = seedDevices()
      const listB = await (await devices.GET(deviceReq({ as: 'parentB' }))).json()
      expect(listB.devices.map((d: any) => d.id)).toEqual(['device-d2'])
      const listA = await (await devices.GET(deviceReq({ as: 'parentA' }))).json()
      expect(JSON.stringify(listA)).not.toContain(FOREIGN)

      const id = params({ id: D1 })
      for (const res of [
        await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentB', body: { label: 'Mine now' } }), id),
        await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentB', body: {} }), id),
        await deviceEvents.GET(deviceReq({ as: 'parentB' }), id),
      ]) {
        expect(res.status).toBe(404)
        expect(await errorCode(res)).toBe('NOT_FOUND')
      }
      expect(db.find('householdDevice', D1)).toMatchObject({ label: 'Kitchen tablet', revoked_at: null })
      expect((await me.GET(deviceReq({ cookies: fx.d1.cookies }))).status).toBe(200)
    })

    it('P2 cannot poll, confirm or cancel an H1 pairing (404), and nothing changes', async () => {
      const p = await pairUpTo('claimed')
      const id = params({ id: p.pairingId })
      for (const res of [
        await pairingById.GET(deviceReq({ as: 'parentB' }), id),
        await pairingConfirm.POST(deviceReq({ method: 'POST', as: 'parentB', body: { digits: p.digits } }), id),
        await pairingById.DELETE(deviceReq({ method: 'DELETE', as: 'parentB' }), id),
      ]) {
        expect(res.status).toBe(404)
      }
      expect(db.find('devicePairing', p.pairingId)).toMatchObject({ confirmed_at: null, cancelled_at: null, confirm_attempts: 0 })
    })

    it('teen and child sessions get 403 PARENT_REQUIRED on every parent route; no session gets 401', async () => {
      const fx = seedDevices()
      const p = await pairUpTo('claimed')
      const calls = (as: UserKey | null) => [
        devices.GET(deviceReq({ as })),
        deviceById.PATCH(deviceReq({ method: 'PATCH', as, body: { label: 'x' } }), params({ id: D1 })),
        deviceRevoke.POST(deviceReq({ method: 'POST', as, body: {} }), params({ id: D1 })),
        deviceEvents.GET(deviceReq({ as }), params({ id: D1 })),
        pairings.POST(deviceReq({ method: 'POST', as, body: { label: 'x' } })),
        pairingById.GET(deviceReq({ as }), params({ id: p.pairingId })),
        pairingById.DELETE(deviceReq({ method: 'DELETE', as }), params({ id: p.pairingId })),
        pairingConfirm.POST(deviceReq({ method: 'POST', as, body: { digits: p.digits } }), params({ id: p.pairingId })),
        elevationPin.PUT(deviceReq({ method: 'PUT', as, body: { pin: '482913', currentPassword: 'x' } })),
        elevationPin.DELETE(deviceReq({ method: 'DELETE', as })),
      ]
      for (const who of ['teenA', 'childA'] as const) {
        for (const res of await Promise.all(calls(who))) {
          expect(res.status).toBe(403)
          expect(await errorCode(res)).toBe('PARENT_REQUIRED')
        }
      }
      for (const res of await Promise.all(calls(null))) expect(res.status).toBe(401)
      // A device cookie alone is not a person session.
      const deviceOnly = await devices.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(deviceOnly.status).toBe(401)
      expect(db.find('devicePairing', p.pairingId)!.cancelled_at).toBeNull()
    })
  })

  describe('device list, rename, revoke, events', () => {
    it('reports active, removed and expired (30 days idle) devices; removed ones hide after 30 days', async () => {
      seedDevices()
      await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'replaced' } }), params({ id: 'device-d1b' }))
      const before = await (await devices.GET(deviceReq({ as: 'parentA' }))).json()
      expect(before.devices.map((d: any) => [d.id, d.status]).sort()).toEqual([
        [D1, 'active'],
        ['device-d1b', 'removed'],
      ])
      advance(31 * 24 * 60 * 60 * 1000)
      // §14.3 item 21: D1 never refreshed in 30 days → "expired"; D1b hidden.
      const list = await (await devices.GET(deviceReq({ as: 'parentA' }))).json()
      expect(list.devices).toEqual([expect.objectContaining({ id: D1, status: 'expired' })])
    })

    it('rename and revoke are audited; revoke is idempotent', async () => {
      seedDevices()
      const renamed = await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: 'Fridge' } }), params({ id: D1 }))
      expect(renamed.status).toBe(200)
      expect((await renamed.json()).device).toMatchObject({ id: D1, label: 'Fridge', status: 'active' })
      for (let i = 0; i < 2; i++) {
        const res = await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'other' } }), params({ id: D1 }))
        expect(res.status).toBe(200)
        expect((await res.json()).device).toMatchObject({ status: 'removed', revokeReason: 'parent' })
      }
      expect((await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'bogus' } }), params({ id: D1 }))).status).toBe(400)
      expect((await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: 'x' } }), params({ id: D1 }))).status).toBe(400)

      const events = await (await deviceEvents.GET(deviceReq({ as: 'parentA' }), params({ id: D1 }))).json()
      expect(events.events.map((e: any) => e.type).sort()).toEqual(['device.renamed', 'device.revoked'])
      expect(events.events[0]).toMatchObject({ actorName: 'Parent A' })
      expect(events.nextCursor).toBeNull()
    })

    it('events paginate 50 per page', async () => {
      seedDevices()
      for (let i = 0; i < 55; i++) {
        db.rows('deviceAuditEvent').push({
          id: `evt-${String(i).padStart(3, '0')}`,
          family_id: FAMILY_A,
          device_id: D1,
          actor_user_id: null,
          type: 'device.renamed',
          metadata: {},
          created_at: new Date(T0.getTime() + i * 1000),
        })
      }
      const first = await (await deviceEvents.GET(deviceReq({ as: 'parentA' }), params({ id: D1 }))).json()
      expect(first.events).toHaveLength(50)
      const second = await (
        await deviceEvents.GET(deviceReq({ as: 'parentA', query: { cursor: first.nextCursor } }), params({ id: D1 }))
      ).json()
      expect(second.events).toHaveLength(5)
      expect(second.nextCursor).toBeNull()
    })

    it('opening the list prunes old pairings and audit rows for this household only', async () => {
      const old = new Date(T0.getTime() - 200 * 24 * 60 * 60 * 1000)
      for (const family_id of [FAMILY_A, FAMILY_B]) {
        db.rows('deviceAuditEvent').push({ id: `old-${family_id}`, family_id, type: 'device.renamed', metadata: {}, created_at: old })
        db.rows('devicePairing').push({ id: `oldp-${family_id}`, family_id, code_hash: `h-${family_id}`, label: 'x', created_by: 'x', expires_at: old })
      }
      await devices.GET(deviceReq({ as: 'parentA' }))
      expect(db.rows('deviceAuditEvent').map((e) => e.id)).toEqual([`old-${FAMILY_B}`])
      expect(db.rows('devicePairing').map((e) => e.id)).toEqual([`oldp-${FAMILY_B}`])
    })
  })

  // §14.4 item 31
  describe('rate limits (documented counts, Retry-After)', () => {
    async function expect429(res: any) {
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    }

    it('pairing creation: 5 per parent per hour, 10 per household per hour', async () => {
      for (let i = 0; i < 5; i++) expect((await createPairing()).res.status).toBe(201)
      await expect429((await createPairing()).res)

      // Two more parents in H1 share the household budget of 10.
      for (const id of ['parent-a2', 'parent-a3']) {
        db.rows('user').push({ ...db.find('user', 'parent-a')!, id, email: `${id}@example.test` })
      }
      const as = (id: string) =>
        pairings.POST(deviceReq({ method: 'POST', cookies: { session_token: `session:${id}` }, body: { label: 'x' } }))
      for (let i = 0; i < 5; i++) expect((await as('parent-a2')).status).toBe(201)
      await expect429(await as('parent-a3'))
    })

    it('claims: 10 per IP per 15 minutes', async () => {
      for (let i = 0; i < 10; i++) expect((await claimCode('ZZZZ-ZZZZ', {}, '192.0.2.9')).res.status).toBe(400)
      await expect429((await claimCode('ZZZZ-ZZZZ', {}, '192.0.2.9')).res)
      expect((await claimCode('ZZZZ-ZZZZ', {}, '192.0.2.10')).res.status).toBe(400)
    })

    it('tablet status: 300 per pairing per 10 minutes; parent poll: 300 per parent per 10 minutes', async () => {
      const p = await pairUpTo('claimed')
      for (let i = 0; i < 300; i++) await pollStatus(p.claimToken)
      await expect429(await pollStatus(p.claimToken))
      for (let i = 0; i < 300; i++) await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: p.pairingId }))
      await expect429(await pairingById.GET(deviceReq({ as: 'parentA' }), params({ id: p.pairingId })))
    })

    it('rename/revoke: 30 per parent per hour', async () => {
      seedDevices()
      for (let i = 0; i < 30; i++) {
        await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: `L${i}` } }), params({ id: D1 }))
      }
      await expect429(await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: {} }), params({ id: D1 })))
      expect(db.find('householdDevice', D1)!.revoked_at).toBeNull()
    })
  })

  describe('PUT/DELETE /api/users/elevation-pin', () => {
    beforeEach(() => setPassword('parentA', 'parent-a-password'))

    const put = (body: unknown) => elevationPin.PUT(deviceReq({ method: 'PUT', as: 'parentA', body }))

    it('sets a bcrypt-hashed PIN only with the current password', async () => {
      const wrong = await put({ pin: '482913', currentPassword: 'nope' })
      expect(wrong.status).toBe(401)
      expect(await errorCode(wrong)).toBe('INVALID_PASSWORD')
      expect(db.rows('parentElevationPin')).toHaveLength(0)

      const ok = await put({ pin: '482913', currentPassword: 'parent-a-password' })
      expect(ok.status).toBe(204)
      const row = db.rows('parentElevationPin')[0]
      expect(row).toMatchObject({ user_id: 'parent-a', family_id: FAMILY_A, locked_until: null })
      expect(row.pin_hash).toMatch(/^\$2[aby]\$12\$/)
      expect(JSON.stringify(row)).not.toContain('482913')
      expect(db.rows('deviceAuditEvent').at(-1)).toMatchObject({ type: 'parent_pin.set', actor_user_id: 'parent-a' })

      // Change keeps one row and clears any lock.
      row.locked_until = new Date(T0.getTime() + 60 * 60 * 1000)
      expect((await put({ pin: '591736', currentPassword: 'parent-a-password' })).status).toBe(204)
      expect(db.rows('parentElevationPin')).toHaveLength(1)
      expect(db.rows('parentElevationPin')[0].locked_until).toBeNull()
    })

    it.each([
      '000000', '111111', '999999', '123456', '234567', '456789', '012345', '987654', '654321', '543210',
      '12345', '1234567', 'abcdef', '12 456',
    ])('rejects weak or malformed PIN %s with 400 PIN_TOO_WEAK', async (pin) => {
      const res = await put({ pin, currentPassword: 'parent-a-password' })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('PIN_TOO_WEAK')
    })

    it('DELETE removes the PIN and is idempotent; PIN set is limited to 5 per hour', async () => {
      await put({ pin: '482913', currentPassword: 'parent-a-password' })
      for (let i = 0; i < 2; i++) expect((await elevationPin.DELETE(deviceReq({ method: 'DELETE', as: 'parentA' }))).status).toBe(204)
      expect(db.rows('parentElevationPin')).toHaveLength(0)
      expect(db.rows('deviceAuditEvent').filter((e) => e.type === 'parent_pin.removed')).toHaveLength(1)
      for (let i = 0; i < 4; i++) await put({ pin: '482913', currentPassword: 'parent-a-password' })
      const limited = await put({ pin: '482913', currentPassword: 'parent-a-password' })
      expect(limited.status).toBe(429)
    })
  })
})
