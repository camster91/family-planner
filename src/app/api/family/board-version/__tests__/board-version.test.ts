// Visible sync (#271): GET /api/family/board-version and GET
// /api/device/today/version on the two-household harness.
//
// - every person role of a household may read its own board's version, and
//   nothing else (the body is `{ version }` only);
// - the version moves when the caller's household changes what the board
//   shows, and never because of the other household;
// - it matches the version the full board carries (page and device DTO);
// - a paired tablet is refused on the person route and uses its own route,
//   with the device's household only, kill switch 404, no cookie 401;
// - both routes are rate limited;
// - photos (person only) move the person version, never the device one.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => {
  const state = { allowed: true, keys: [] as string[] }
  return {
    __state: state,
    checkRateLimit: async (key: string) => {
      state.keys.push(key)
      return state.allowed
        ? { allowed: true, remaining: 99, retryAfterMs: 0 }
        : { allowed: false, remaining: 0, retryAfterMs: 42_000 }
    },
    isRateLimited: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    resetRateLimit: async () => undefined,
    cleanupRateLimits: async () => 0,
  }
})

import { FAMILY_A, FAMILY_B, FOREIGN, bodyOf, db, fakePrisma, req, type UserKey } from '@/__tests__/helpers/two-household'
import {
  D1,
  deviceReq,
  disableSharedDevice,
  enableSharedDevice,
  errorCode,
  resetClock,
  seedDevices,
  setNow,
  clearsDeviceCookies,
} from '@/__tests__/helpers/device'
import * as personVersion from '../route'
import * as deviceVersion from '@/app/api/device/today/version/route'
import * as deviceToday from '@/app/api/device/today/route'
import { loadTodayBoard } from '@/app/dashboard/today/board-snapshot'

const rateState = (jest.requireMock('@/lib/rate-limit-db') as { __state: { allowed: boolean; keys: string[] } }).__state
const T0 = new Date()

async function versionAs(who: UserKey): Promise<string> {
  const res = await personVersion.GET(req({ as: who }))
  expect(res.status).toBe(200)
  const body = await bodyOf(res)
  expect(Object.keys(body)).toEqual(['version'])
  return body.version
}

function addUpload(id: string, familyId: string, filename: string, contentType = 'image/jpeg') {
  db.rows('upload').push({
    id,
    family_id: familyId,
    uploaded_by: familyId === FAMILY_A ? 'parent-a' : 'parent-b',
    filename,
    content_type: contentType,
    size_bytes: 1000,
    created_at: T0,
  })
}

describe('board version (#271)', () => {
  let fx: ReturnType<typeof seedDevices>

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    rateState.allowed = true
    rateState.keys = []
    enableSharedDevice()
    setNow(T0)
    fx = seedDevices()
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  describe('GET /api/family/board-version (people)', () => {
    it.each<[UserKey]>([['parentA'], ['teenA'], ['childA']])('%s reads a version, no-store, and nothing else', async (who) => {
      const res = await personVersion.GET(req({ as: who }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await bodyOf(res)
      expect(body).toEqual({ version: expect.stringMatching(/^v1-[0-9a-f]{24}$/) })
      expect(JSON.stringify(body)).not.toContain(FOREIGN)
    })

    it('requires a session and a household', async () => {
      expect((await personVersion.GET(req({ as: null }))).status).toBe(401)
      expect((await personVersion.GET(req({ as: 'loner' }))).status).toBe(400)
    })

    it("a paired tablet's cookie is not a session (401)", async () => {
      const res = await personVersion.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(401)
    })

    it("moves when the caller's household changes what the board shows, never for the other household", async () => {
      const before = await versionAs('parentA')
      const childBefore = await versionAs('childA')

      // Family B edits: chore status, event title, grocery item, meal, member name.
      db.find('chore', 'chore-b')!.status = 'completed'
      db.find('event', 'event-b')!.title = `${FOREIGN} moved`
      db.find('listItem', 'item-b')!.content = `${FOREIGN} bread`
      db.find('familyMeal', 'meal-b')!.recipe_name = `${FOREIGN} soup`
      db.find('user', 'parent-b')!.name = `${FOREIGN} renamed`
      db.rows('chore').splice(
        db.rows('chore').findIndex((c) => c.family_id === FAMILY_B),
        1
      )
      expect(await versionAs('parentA')).toBe(before)
      expect(await versionAs('childA')).toBe(childBefore)

      // Family A: a chore is ticked (chores have no updated_at).
      db.find('chore', 'chore-a')!.status = 'completed'
      const afterChore = await versionAs('parentA')
      expect(afterChore).not.toBe(before)
      expect(await versionAs('childA')).not.toBe(childBefore)

      // A deleted row leaves no timestamp; the version still moves.
      db.rows('listItem').splice(
        db.rows('listItem').findIndex((i) => i.id === 'item-a'),
        1
      )
      const afterDelete = await versionAs('parentA')
      expect(afterDelete).not.toBe(afterChore)

      // Display settings are part of what the board shows.
      db.find('family', FAMILY_A)!.night_start = '21:30'
      db.find('family', FAMILY_A)!.night_end = '06:30'
      expect(await versionAs('parentA')).not.toBe(afterDelete)
    })

    it('matches the version on the full board the page renders', async () => {
      const board = await loadTodayBoard(fakePrisma, { familyId: FAMILY_A, role: 'parent', withWeather: true })
      expect(await versionAs('parentA')).toBe(board.version)
    })

    it('is rate limited per member (429 with Retry-After)', async () => {
      await versionAs('teenA')
      expect(rateState.keys).toEqual(['board-version:teen-a'])
      rateState.allowed = false
      const res = await personVersion.GET(req({ as: 'teenA' }))
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('42')
    })
  })

  describe('GET /api/device/today/version (paired tablet)', () => {
    async function deviceVersionOf(cookies: Record<string, string>): Promise<string> {
      const res = await deviceVersion.GET(deviceReq({ cookies }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      expect(Object.keys(body)).toEqual(['version'])
      return body.version
    }

    it("D1 follows only H1's changes; D2 only H2's", async () => {
      const d1 = await deviceVersionOf(fx.d1.cookies)
      const d2 = await deviceVersionOf(fx.d2.cookies)
      db.find('chore', 'chore-b')!.status = 'completed'
      expect(await deviceVersionOf(fx.d1.cookies)).toBe(d1)
      const d2After = await deviceVersionOf(fx.d2.cookies)
      expect(d2After).not.toBe(d2)
      db.find('chore', 'chore-a')!.status = 'completed'
      expect(await deviceVersionOf(fx.d1.cookies)).not.toBe(d1)
      expect(await deviceVersionOf(fx.d2.cookies)).toBe(d2After)
    })

    it('matches the version on GET /api/device/today', async () => {
      const board = await (await deviceToday.GET(deviceReq({ cookies: fx.d1.cookies }))).json()
      expect(await deviceVersionOf(fx.d1.cookies)).toBe(board.version)
    })

    it('without a device cookie: 401; a person session is not accepted', async () => {
      const res = await deviceVersion.GET(deviceReq({ as: 'parentA' }))
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('DEVICE_SESSION_INVALID')
    })

    it('a revoked tablet gets DEVICE_REVOKED and its cookies cleared', async () => {
      db.find('householdDevice', D1)!.revoked_at = T0
      const res = await deviceVersion.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('DEVICE_REVOKED')
      expect(clearsDeviceCookies(res)).toBe(true)
    })

    it('kill switch off: 404 and device cookies expired', async () => {
      disableSharedDevice()
      const res = await deviceVersion.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(404)
      expect(clearsDeviceCookies(res)).toBe(true)
    })

    it('is rate limited per tablet (429 RATE_LIMITED with Retry-After)', async () => {
      await deviceVersionOf(fx.d1.cookies)
      expect(rateState.keys).toEqual([`device-board-version:${D1}`])
      rateState.allowed = false
      const res = await deviceVersion.GET(deviceReq({ cookies: fx.d1.cookies }))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(res.headers.get('Retry-After')).toBe('42')
    })
  })

  describe('calm display data (photos never reach a tablet)', () => {
    beforeEach(() => {
      addUpload('up-a', FAMILY_A, 'aaaaaaaaaaaaaaa1.jpg')
      addUpload('up-a-heic', FAMILY_A, 'aaaaaaaaaaaaaaa2.heic', 'image/heic')
      addUpload('up-b', FAMILY_B, 'bbbbbbbbbbbbbbb1.jpg')
      db.find('family', FAMILY_A)!.ambient_photo_ids = ['up-b', 'up-a', 'up-a-heic', 'missing']
      db.find('family', FAMILY_A)!.ambient_idle_minutes = 10
      db.find('family', FAMILY_A)!.night_start = '22:00'
      db.find('family', FAMILY_A)!.night_end = '06:00'
    })

    it("a member's board shows only the household's own displayable photos", async () => {
      const board = await loadTodayBoard(fakePrisma, { familyId: FAMILY_A, role: 'child' })
      expect(board.display).toEqual({
        idleMinutes: 10,
        night: { start: '22:00', end: '06:00' },
        photos: [{ id: 'up-a', url: '/api/files/chores/aaaaaaaaaaaaaaa1.jpg' }],
      })
    })

    it('the device board has the display settings but no photos at all', async () => {
      const body = await (await deviceToday.GET(deviceReq({ cookies: fx.d1.cookies }))).json()
      expect(body.display).toEqual({ idleMinutes: 10, night: { start: '22:00', end: '06:00' } })
      const text = JSON.stringify(body)
      for (const s of ['up-a', 'aaaaaaaaaaaaaaa1', '/api/files', 'photo']) expect(text).not.toContain(s)
    })

    it('choosing photos moves the person version but not the device version', async () => {
      const person = await versionAs('parentA')
      const device = (await (await deviceVersion.GET(deviceReq({ cookies: fx.d1.cookies }))).json()).version
      db.find('family', FAMILY_A)!.ambient_photo_ids = []
      expect(await versionAs('parentA')).not.toBe(person)
      expect((await (await deviceVersion.GET(deviceReq({ cookies: fx.d1.cookies }))).json()).version).toBe(device)
    })
  })
})
