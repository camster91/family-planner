// Household audit history writes (#285, PR101 D-4): every audited change
// writes exactly the expected row, in the change's household, with a fixed
// action and a names-only summary; refused and no-op requests write none.
// Atomicity against a real transaction is proven in
// src/lib/__tests__/household-audit.integration.test.ts.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  DUMMY_HASH: require('bcryptjs').hashSync('dummy-password-not-used', 4),
}))
jest.mock('@/lib/mail', () => ({
  sendMail: jest.fn(async () => undefined),
  familyInviteEmail: () => ({ subject: 'Join', html: '<p>Join</p>', text: 'Join' }),
  isMailConfigured: () => true,
}))

import { FAMILY_B, FOREIGN, params, req, type UserKey } from '@/__tests__/helpers/two-household'
import {
  FAMILY_A,
  db,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  resetClock,
  seedDevice,
  seedDevices,
  setNow,
  setPin,
} from '@/__tests__/helpers/device'
import { sendMail } from '@/lib/mail'
import { MEMBER_COLOR_KEYS } from '@/lib/member-colors'
import { AUDIT_ACTIONS } from '@/lib/household-audit'
import * as features from '../../family/features/route'
import * as boardSettings from '../../family/board-settings/route'
import * as invites from '../../family/invites/route'
import * as inviteById from '../../family/invites/[id]/route'
import * as join from '../../family/join/route'
import * as register from '../../auth/register/route'
import { hashInviteToken } from '@/lib/family-invite'
import * as deviceById from '../../family/devices/[id]/route'
import * as deviceRevoke from '../../family/devices/[id]/revoke/route'
import * as pairings from '../../family/devices/pairings/route'
import * as pairingConfirm from '../../family/devices/pairings/[id]/confirm/route'
import * as claim from '../../device/pair/claim/route'
import * as pairStatus from '../../device/pair/status/route'
import * as elevation from '../../device/elevation/route'
import * as elevatedSettings from '../../device/elevated/board-settings/route'
import * as label from '../../device/label/route'
import * as revokeSelf from '../../device/revoke-self/route'

const T0 = new Date('2026-09-26T12:00:00Z')
const PIN = '482913'

function auditRows() {
  return db.rows('auditLog')
}

function onlyRow() {
  expect(auditRows()).toHaveLength(1)
  return auditRows()[0]
}

function expectSafeSummaries() {
  for (const r of auditRows()) {
    expect(AUDIT_ACTIONS).toContain(r.action)
    expect(r.summary.length).toBeLessThanOrEqual(200)
    expect(r.summary).not.toMatch(/@|fpd1_|token|\d{6}/)
  }
}

async function elevationToken(cookies: Record<string, string>) {
  const res = await elevation.POST(deviceReq({ method: 'POST', cookies, body: { userId: 'parent-a', method: 'pin', secret: PIN } }))
  expect(res.status).toBe(200)
  return (await res.json()).elevationToken as string
}

describe('household audit writes', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    setNow(T0)
    ;(sendMail as jest.Mock).mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    disableSharedDevice()
  })
  afterAll(() => resetClock())

  describe('feature toggles', () => {
    it('one row per feature that changed, with the feature title', async () => {
      db.find('family', FAMILY_A)!.features = { meals: true, wishlist: false, pickups: false }
      const res = await features.PATCH(req({ as: 'parentA', method: 'PATCH', body: { features: { wishlist: true, pickups: true, meals: false } } }))
      expect(res.status).toBe(200)
      const rows = auditRows().map((r) => [r.family_id, r.actor_user_id, r.actor_kind, r.action, r.target_type, r.target_id, r.summary])
      expect(rows).toEqual(
        expect.arrayContaining([
          [FAMILY_A, 'parent-a', 'person', 'feature.turned_off', 'feature', 'meals', 'Turned off Meal planning'],
          [FAMILY_A, 'parent-a', 'person', 'feature.turned_on', 'feature', 'wishlist', 'Turned on Wishlist'],
          [FAMILY_A, 'parent-a', 'person', 'feature.turned_on', 'feature', 'pickups', 'Turned on Pickups & dropoffs'],
        ])
      )
      expect(rows).toHaveLength(3)
      expectSafeSummaries()
    })

    it('no row when nothing changed, for a refused core toggle, or for a teen or child', async () => {
      db.find('family', FAMILY_A)!.features = { wishlist: true }
      expect((await features.PATCH(req({ as: 'parentA', method: 'PATCH', body: { key: 'wishlist', enabled: true } }))).status).toBe(200)
      expect((await features.PATCH(req({ as: 'parentA', method: 'PATCH', body: { key: 'chores', enabled: false } }))).status).toBe(400)
      for (const who of ['teenA', 'childA'] as UserKey[]) {
        expect((await features.PATCH(req({ as: who, method: 'PATCH', body: { key: 'wishlist', enabled: false } }))).status).toBe(403)
      }
      expect(auditRows()).toHaveLength(0)
    })

    it("a parent's change is recorded only in their own household", async () => {
      await features.PATCH(req({ as: 'parentB', method: 'PATCH', body: { key: 'wishlist', enabled: true } }))
      expect(onlyRow().family_id).toBe(FAMILY_B)
    })
  })

  describe('board settings', () => {
    // Stored values as Postgres would hold them (the fake has no column defaults for these).
    beforeEach(() => {
      Object.assign(db.find('family', FAMILY_A)!, {
        weather_enabled: false,
        weather_latitude: null,
        weather_longitude: null,
        weather_label: null,
        weather_unit: 'celsius',
        ambient_idle_minutes: 5,
        night_start: null,
        night_end: null,
        ambient_photo_ids: [],
        device_writes_enabled: false,
      })
      for (const u of db.rows('user')) if (u.board_color === undefined) u.board_color = null
    })

    it('person door: a no-op section or the saved value writes no row; a real change writes one', async () => {
      const patch = (body: unknown) => boardSettings.PATCH(req({ as: 'parentA', method: 'PATCH', body }))
      for (const body of [{ weather: {} }, { display: { idleMinutes: 5 } }, { deviceWrites: { enabled: false } }, { memberColors: {} }]) {
        expect((await patch(body)).status).toBe(200)
      }
      expect(auditRows()).toHaveLength(0)
      // Idle minutes changes, night hours are resubmitted unchanged: only "calm display" once.
      expect((await patch({ display: { idleMinutes: 10 }, weather: { unit: 'celsius' } })).status).toBe(200)
      expect(onlyRow().summary).toBe('Changed the Today board settings: calm display')
      // A retry of the same change records nothing more.
      await patch({ display: { idleMinutes: 10 } })
      expect(auditRows()).toHaveLength(1)
    })

    it('elevated tablet door: a no-op writes no row either', async () => {
      enableSharedDevice()
      const fx = seedDevices()
      setPin('parentA', PIN)
      const t = await elevationToken(fx.d1.cookies)
      const patch = (body: unknown) =>
        elevatedSettings.PATCH(deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': t }, body }))
      expect((await patch({ deviceWrites: { enabled: false } })).status).toBe(200)
      expect((await patch({ weather: {} })).status).toBe(200)
      expect(auditRows()).toHaveLength(0)
      expect((await patch({ deviceWrites: { enabled: true } })).status).toBe(200)
      expect(onlyRow()).toMatchObject({ actor_kind: 'device', summary: 'Changed the Today board settings: tablet changes' })
    })

    it('person door: section names only, never values', async () => {
      const color = MEMBER_COLOR_KEYS[1]
      const res = await boardSettings.PATCH(
        req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'teen-a': color }, display: { night: { start: '21:00', end: '06:30' } } } })
      )
      expect(res.status).toBe(200)
      const r = onlyRow()
      expect(r).toMatchObject({
        family_id: FAMILY_A,
        actor_user_id: 'parent-a',
        actor_kind: 'person',
        action: 'board_settings.changed',
        target_type: 'family',
        target_id: FAMILY_A,
        summary: 'Changed the Today board settings: member colours and calm display',
      })
      expect(r.summary).not.toContain(color)
      expect(r.summary).not.toContain('21:00')
    })

    it('a refused patch (foreign member) writes no row; teens get 403 and no row', async () => {
      const refused = await boardSettings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'parent-b': MEMBER_COLOR_KEYS[0] } } }))
      expect(refused.status).toBe(400)
      const teen = await boardSettings.PATCH(req({ as: 'teenA', method: 'PATCH', body: { display: { idleMinutes: 0 } } }))
      expect(teen.status).toBe(403)
      expect(auditRows()).toHaveLength(0)
    })

    it('elevated tablet door: actor is the parent, kind "device"', async () => {
      enableSharedDevice()
      const fx = seedDevices()
      setPin('parentA', PIN)
      const t = await elevationToken(fx.d1.cookies)
      const res = await elevatedSettings.PATCH(
        deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': t }, body: { deviceWrites: { enabled: true } } })
      )
      expect(res.status).toBe(200)
      expect(onlyRow()).toMatchObject({
        family_id: FAMILY_A,
        actor_user_id: 'parent-a',
        actor_kind: 'device',
        action: 'board_settings.changed',
        summary: 'Changed the Today board settings: tablet changes',
      })
    })
  })

  describe('invites', () => {
    it('created and revoked, with the role and never the email address', async () => {
      const res = await invites.POST(req({ as: 'parentA', method: 'POST', body: { email: 'new.person@invitee.test', role: 'teen' } }))
      expect(res.status).toBe(200)
      const invite = db.rows('familyInvite').find((i) => i.email === 'new.person@invitee.test')!
      expect(onlyRow()).toMatchObject({
        family_id: FAMILY_A,
        actor_user_id: 'parent-a',
        action: 'invite.created',
        target_type: 'invite',
        target_id: invite.id,
        summary: 'Sent an invite to join as a teen',
      })
      const del = await inviteById.DELETE(req({ as: 'parentA', method: 'DELETE' }), params({ id: invite.id }))
      expect(del.status).toBe(200)
      expect(auditRows().map((r) => [r.action, r.summary])).toEqual([
        ['invite.created', 'Sent an invite to join as a teen'],
        ['invite.revoked', 'Cancelled an invite to join as a teen'],
      ])
      expect(JSON.stringify(auditRows())).not.toContain('invitee.test')
      expectSafeSummaries()
    })

    it('resending records the pending invite it replaces as cancelled; an expired one is just cleared (#285 review)', async () => {
      const send = (role: string) =>
        invites.POST(req({ as: 'parentA', method: 'POST', body: { email: 'new.person@invitee.test', role } }))
      expect((await send('teen')).status).toBe(200)
      const first = db.rows('familyInvite').find((i) => i.email === 'new.person@invitee.test')!
      expect((await send('child')).status).toBe(200)
      expect(db.find('familyInvite', first.id)).toBeUndefined()
      expect(auditRows().map((r) => [r.action, r.target_id === first.id, r.summary])).toEqual([
        ['invite.created', true, 'Sent an invite to join as a teen'],
        ['invite.revoked', true, 'Cancelled an invite to join as a teen'],
        ['invite.created', false, 'Sent an invite to join as a child'],
      ])

      // An invite that had already expired stopped working on its own.
      const second = db.rows('familyInvite').find((i) => i.email === 'new.person@invitee.test')!
      second.expires_at = new Date(Date.now() - 1000)
      expect((await send('teen')).status).toBe(200)
      expect(db.find('familyInvite', second.id)).toBeUndefined()
      expect(auditRows().filter((r) => r.action === 'invite.revoked')).toHaveLength(1)
      expect(JSON.stringify(auditRows())).not.toContain('invitee.test')
      expectSafeSummaries()
    })

    it('a failed email removes the invite and its history row together', async () => {
      ;(sendMail as jest.Mock).mockRejectedValueOnce(new Error('mail down'))
      const res = await invites.POST(req({ as: 'parentA', method: 'POST', body: { email: 'new.person@invitee.test', role: 'child' } }))
      expect(res.status).toBe(500)
      expect(db.rows('familyInvite').find((i) => i.email === 'new.person@invitee.test')).toBeUndefined()
      expect(auditRows()).toHaveLength(0)
    })

    it('mail not configured: 503 with a parent-facing message, no server variable names', async () => {
      ;(sendMail as jest.Mock).mockRejectedValueOnce(new Error('MAILGUN_API_KEY is not set'))
      const res = await invites.POST(req({ as: 'parentA', method: 'POST', body: { email: 'new.person@invitee.test', role: 'child' } }))
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toMatch(/family code/i)
      expect(body.error).not.toMatch(/MAILGUN|server/i)
      expect(db.rows('familyInvite').find((i) => i.email === 'new.person@invitee.test')).toBeUndefined()
    })

    it("revoking another household's invite is 404 and writes nothing", async () => {
      const res = await inviteById.DELETE(req({ as: 'parentA', method: 'DELETE' }), params({ id: 'invite-b' }))
      expect(res.status).toBe(404)
      expect(db.find('familyInvite', 'invite-b')).toBeDefined()
      expect(auditRows()).toHaveLength(0)
    })
  })

  describe('member joins', () => {
    it('joining by invite code records the new member and their role', async () => {
      db.find('user', 'loner')!.name = 'Lonny'
      const res = await join.POST(req({ as: 'loner', method: 'POST', body: { inviteCode: 'INVITEA1' } }))
      expect(res.status).toBe(200)
      expect(onlyRow()).toMatchObject({
        family_id: FAMILY_A,
        actor_user_id: 'loner',
        actor_kind: 'person',
        action: 'member.joined',
        target_type: 'member',
        target_id: 'loner',
        summary: 'Lonny joined as a child',
      })
    })
  })

  describe('registering with an emailed invite', () => {
    it('records the new member and their role in the invite household', async () => {
      const token = 'c'.repeat(64)
      Object.assign(db.find('familyInvite', 'invite-a')!, { token_hash: hashInviteToken(token), email: 'newbie@invitee.test', role: 'teen' })
      const res = await register.POST(
        req({ method: 'POST', body: { email: 'newbie@invitee.test', password: 'long-enough-pw', name: 'Newbie', inviteToken: token } })
      )
      expect(res.status).toBe(200)
      const user = db.rows('user').find((u) => u.email === 'newbie@invitee.test')!
      expect(onlyRow()).toMatchObject({
        family_id: FAMILY_A,
        actor_user_id: user.id,
        action: 'member.joined',
        target_id: user.id,
        summary: 'Newbie joined as a teen',
      })
    })
  })

  describe('devices', () => {
    beforeEach(() => enableSharedDevice())

    it('rename and remove from the parent device list', async () => {
      seedDevice('dev-a', FAMILY_A, 'Kitchen')
      const renamed = await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: 'Hall' } }), params({ id: 'dev-a' }))
      expect(renamed.status).toBe(200)
      // Same label again: no change, no row.
      await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: 'Hall' } }), params({ id: 'dev-a' }))
      const removed = await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: { reason: 'lost' } }), params({ id: 'dev-a' }))
      expect(removed.status).toBe(200)
      // Removing again is idempotent and records nothing more.
      await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: {} }), params({ id: 'dev-a' }))
      expect(auditRows().map((r) => [r.action, r.actor_kind, r.target_id, r.summary])).toEqual([
        ['device.renamed', 'person', 'dev-a', 'Renamed the tablet “Kitchen” to “Hall”'],
        ['device.removed', 'person', 'dev-a', 'Removed the tablet “Hall” (lost)'],
      ])
    })

    it("another household's tablet is 404 and records nothing", async () => {
      seedDevice('dev-b', FAMILY_B, `${FOREIGN} tablet`)
      expect((await deviceById.PATCH(deviceReq({ method: 'PATCH', as: 'parentA', body: { label: 'Mine' } }), params({ id: 'dev-b' }))).status).toBe(404)
      expect((await deviceRevoke.POST(deviceReq({ method: 'POST', as: 'parentA', body: {} }), params({ id: 'dev-b' }))).status).toBe(404)
      expect(auditRows()).toHaveLength(0)
    })

    it('rename and remove on the tablet itself are recorded with kind "device"', async () => {
      const fx = seedDevices()
      setPin('parentA', PIN)
      const t = await elevationToken(fx.d1.cookies)
      const renamed = await label.PATCH(deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, headers: { 'x-device-elevation': t }, body: { label: 'Fridge' } }))
      expect(renamed.status).toBe(200)
      const removed = await revokeSelf.POST(deviceReq({ method: 'POST', cookies: fx.d1.cookies, headers: { 'x-device-elevation': t } }))
      expect(removed.status).toBe(200)
      expect(auditRows().map((r) => [r.family_id, r.actor_user_id, r.actor_kind, r.action, r.summary])).toEqual([
        [FAMILY_A, 'parent-a', 'device', 'device.renamed', 'Renamed the tablet “Kitchen tablet” to “Fridge”'],
        [FAMILY_A, 'parent-a', 'device', 'device.removed', 'Removed the tablet “Fridge”'],
      ])
    })

    it('pairing (and the tablet it replaces) is recorded when the tablet is issued', async () => {
      seedDevice('dev-old', FAMILY_A, 'Old tablet')
      const created = await pairings.POST(deviceReq({ method: 'POST', as: 'parentA', body: { label: 'New tablet', replacesDeviceId: 'dev-old' } }))
      expect(created.status).toBe(201)
      const { code, pairingId } = await created.json()
      const claimed = await (await claim.POST(deviceReq({ method: 'POST', body: { code, platform: 'android', appVersion: '1.0' } }))).json()
      expect((await pairingConfirm.POST(deviceReq({ method: 'POST', as: 'parentA', body: { digits: claimed.confirmDigits } }), params({ id: pairingId }))).status).toBe(200)
      expect(auditRows()).toHaveLength(0) // nothing until the tablet actually exists
      const issued = await pairStatus.POST(deviceReq({ method: 'POST', body: { claimToken: claimed.claimToken } }))
      expect((await issued.json()).status).toBe('paired')
      const device = db.rows('householdDevice').find((d) => d.label === 'New tablet')!
      expect(auditRows().map((r) => [r.family_id, r.actor_user_id, r.action, r.target_id, r.summary])).toEqual([
        [FAMILY_A, 'parent-a', 'device.removed', 'dev-old', 'Removed the tablet “Old tablet” (replaced by a new tablet)'],
        [FAMILY_A, 'parent-a', 'device.paired', device.id, 'Paired the tablet “New tablet”'],
      ])
      // Polling again issues nothing and records nothing.
      await pairStatus.POST(deviceReq({ method: 'POST', body: { claimToken: claimed.claimToken } }))
      expect(auditRows()).toHaveLength(2)
    })
  })
})
