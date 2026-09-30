// Calm display, night hours and photos (#271) in GET/PATCH
// /api/family/board-settings, on the two-household harness: parent only, own
// household only, validated, additive defaults, foreign uploads refused like
// missing ones, and a paired tablet refused.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)

import * as settings from '../route'
import { FAMILY_A, FAMILY_B, FOREIGN, bodyOf, db, req, writesTo, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, disableSharedDevice, enableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const T0 = new Date('2026-09-20T10:00:00Z')

function addUpload(id: string, familyId: string, filename: string, contentType = 'image/jpeg', createdAt = T0) {
  db.rows('upload').push({
    id,
    family_id: familyId,
    uploaded_by: familyId === FAMILY_A ? 'parent-a' : 'parent-b',
    filename,
    content_type: contentType,
    size_bytes: 1000,
    created_at: createdAt,
  })
}

function patch(who: UserKey | null, display: unknown) {
  return settings.PATCH(req({ as: who, method: 'PATCH', body: { display } }))
}

describe('board settings: calm display (#271)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    addUpload('up-a1', FAMILY_A, 'aaaaaaaaaaaaaaa1.jpg', 'image/jpeg', new Date(T0.getTime() - 1000))
    addUpload('up-a2', FAMILY_A, 'aaaaaaaaaaaaaaa2.png', 'image/png', T0)
    addUpload('up-a-heic', FAMILY_A, 'aaaaaaaaaaaaaaa3.heic', 'image/heic')
    addUpload('up-b', FAMILY_B, 'bbbbbbbbbbbbbbb1.jpg')
  })

  it('GET: defaults (5 minutes, night hours off, no photos) and only this household\'s displayable uploads', async () => {
    const body = await bodyOf(await settings.GET(req({ as: 'parentA' })))
    expect(body.display).toEqual({
      idleMinutes: 5,
      idleChoices: [0, 1, 2, 5, 10, 15, 30],
      night: null,
      photoIds: [],
      uploads: [
        { id: 'up-a2', url: '/api/files/chores/aaaaaaaaaaaaaaa2.png', createdAt: T0.toISOString() },
        {
          id: 'up-a1',
          url: '/api/files/chores/aaaaaaaaaaaaaaa1.jpg',
          createdAt: new Date(T0.getTime() - 1000).toISOString(),
        },
      ],
    })
    expect(JSON.stringify(body)).not.toContain('bbbbbbbbbbbbbbb1')
    expect(JSON.stringify(body)).not.toContain(FOREIGN)
  })

  it('GET keeps a chosen photo older than the newest 60 listed, so it can be unticked', async () => {
    for (let i = 0; i < 60; i++) {
      addUpload(`up-new-${i}`, FAMILY_A, `${i.toString(16).padStart(16, '0')}.jpg`, 'image/jpeg', new Date(T0.getTime() + 1000 * (i + 1)))
    }
    db.find('family', FAMILY_A)!.ambient_photo_ids = ['up-a1']
    const body = await bodyOf(await settings.GET(req({ as: 'parentA' })))
    const ids = body.display.uploads.map((u: { id: string }) => u.id)
    expect(ids).toHaveLength(61)
    expect(ids).toContain('up-a1')
    expect(ids).not.toContain('up-a2') // older and not chosen: past the cap
    expect(new Set(ids).size).toBe(ids.length)
    expect(body.display.photoIds).toEqual(['up-a1'])
  })

  it('a parent sets idle minutes, night hours and photos for their own household only', async () => {
    const res = await patch('parentA', {
      idleMinutes: 10,
      night: { start: '21:30', end: '06:30' },
      photoIds: ['up-a2', 'up-a1', 'up-a2'],
    })
    expect(res.status).toBe(200)
    const a = db.find('family', FAMILY_A)!
    expect([a.ambient_idle_minutes, a.night_start, a.night_end, a.ambient_photo_ids]).toEqual([
      10,
      '21:30',
      '06:30',
      ['up-a2', 'up-a1'],
    ])
    const b = db.find('family', FAMILY_B)!
    expect([b.ambient_idle_minutes, b.night_start, b.ambient_photo_ids]).toEqual([undefined, undefined, undefined])
    const body = await bodyOf(res)
    expect(body.display).toMatchObject({ idleMinutes: 10, night: { start: '21:30', end: '06:30' }, photoIds: ['up-a2', 'up-a1'] })

    // Turning night hours off clears both times; 0 turns the calm frame off.
    await patch('parentA', { night: null, idleMinutes: 0 })
    expect([a.night_start, a.night_end, a.ambient_idle_minutes]).toEqual([null, null, 0])
  })

  it("refuses another household's upload exactly like a missing one, writing nothing", async () => {
    const foreign = await patch('parentA', { photoIds: ['up-a1', 'up-b'] })
    const missing = await patch('parentA', { photoIds: ['up-a1', 'nope'] })
    expect(foreign.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(await bodyOf(foreign)).toEqual(await bodyOf(missing))
    expect(writesTo('family')).toHaveLength(0)
  })

  it('refuses photos the board cannot display (HEIC)', async () => {
    expect((await patch('parentA', { photoIds: ['up-a-heic'] })).status).toBe(400)
    expect(writesTo('family')).toHaveLength(0)
  })

  it.each<[string, unknown]>([
    ['an idle time outside the choices', { idleMinutes: 7 }],
    ['a malformed night time', { night: { start: '9pm', end: '06:30' } }],
    ['equal night times', { night: { start: '22:00', end: '22:00' } }],
    ['an unknown key', { brightness: 20 }],
    ['too many photos', { photoIds: Array.from({ length: 21 }, (_, i) => `p${i}`) }],
  ])('rejects %s', async (_label, display) => {
    const res = await patch('parentA', display)
    expect(res.status).toBe(400)
    expect(writesTo('family')).toHaveLength(0)
  })

  it.each<[UserKey]>([['teenA'], ['childA']])('%s gets 403 and nothing is written', async (who) => {
    expect((await settings.GET(req({ as: who }))).status).toBe(403)
    expect((await patch(who, { idleMinutes: 1, photoIds: ['up-a1'] })).status).toBe(403)
    expect(writesTo('family')).toHaveLength(0)
  })

  it('a paired tablet cookie is not a session (401) and cannot change display settings', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      const res = await settings.PATCH(
        deviceReq({ method: 'PATCH', cookies: fx.d1.cookies, body: { display: { idleMinutes: 1 } } })
      )
      expect(res.status).toBe(401)
      expect(writesTo('family')).toHaveLength(0)
    } finally {
      disableSharedDevice()
    }
  })
})
