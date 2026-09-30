// Today board settings (#262): member colours and the opt-in weather place.
//
// Route-level on the two-household harness: parent-only, own household only,
// foreign member ids refused with the same answer as missing ones, place
// stored rounded to 2 decimals, cache dropped for the caller's household only,
// kill switch honoured, place search talks to the fixed Open-Meteo host only.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)

import * as settings from '../route'
import * as places from '../places/route'
import {
  FAMILY_A,
  FAMILY_B,
  FOREIGN,
  bodyOf,
  db,
  req,
  writesTo,
  type UserKey,
} from '@/__tests__/helpers/two-household'

const ORIGINAL_ENV = process.env.WEATHER_ENABLED

function seedCache(familyId: string) {
  db.rows('weatherCache').push({
    family_id: familyId,
    latitude: 1,
    longitude: 1,
    status: 'ok',
    payload: {},
    fetched_at: new Date(),
  })
}

describe('board settings (#262)', () => {
  let fetchSpy: jest.SpyInstance

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    // The kill switch is off unless set; these tests run with it on.
    process.env.WEATHER_ENABLED = '1'
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network call'))
  })
  afterEach(() => fetchSpy.mockRestore())
  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.WEATHER_ENABLED
    else process.env.WEATHER_ENABLED = ORIGINAL_ENV
  })

  describe('access', () => {
    it('requires a session', async () => {
      expect((await settings.GET(req({ as: null }))).status).toBe(401)
      expect((await settings.PATCH(req({ as: null, method: 'PATCH', body: {} }))).status).toBe(401)
      expect((await places.GET(req({ as: null, query: { q: 'Toronto' } }))).status).toBe(401)
    })

    it.each<[UserKey]>([['teenA'], ['childA']])('%s gets 403 everywhere and nothing is written', async (who) => {
      expect((await settings.GET(req({ as: who }))).status).toBe(403)
      const res = await settings.PATCH(
        req({
          as: who,
          method: 'PATCH',
          body: { memberColors: { [`${who === 'teenA' ? 'teen' : 'child'}-a`]: 'green' }, weather: { unit: 'fahrenheit' } },
        })
      )
      expect(res.status).toBe(403)
      expect((await places.GET(req({ as: who, query: { q: 'Toronto' } }))).status).toBe(403)
      expect(writesTo('user')).toHaveLength(0)
      expect(writesTo('family')).toHaveLength(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('GET', () => {
    it("returns only the caller's household, with weather off by default", async () => {
      const res = await settings.GET(req({ as: 'parentA' }))
      expect(res.status).toBe(200)
      const body = await bodyOf(res)
      expect(JSON.stringify(body)).not.toContain(FOREIGN)
      expect(body.weather).toEqual({ available: true, enabled: false, place: null, unit: 'celsius' })
      // Household order: created_at, then id (the fixtures share created_at).
      expect(body.members.map((m: any) => m.id)).toEqual(['child-a', 'parent-a', 'teen-a'])
      // Deterministic fallback colours in household order.
      expect(body.members.map((m: any) => [m.color, m.custom])).toEqual([
        ['indigo', false],
        ['sky', false],
        ['green', false],
      ])
    })

    it.each([['unset', undefined], ['false', 'false']])('reports the server kill switch as off when %s', async (_l, value) => {
      if (value === undefined) delete process.env.WEATHER_ENABLED
      else process.env.WEATHER_ENABLED = value
      const body = await bodyOf(await settings.GET(req({ as: 'parentA' })))
      expect(body.weather.available).toBe(false)
    })
  })

  describe('member colours', () => {
    it('sets and clears a colour for a member of the household', async () => {
      const res = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'child-a': 'orange' } } }))
      expect(res.status).toBe(200)
      expect(db.find('user', 'child-a')!.board_color).toBe('orange')
      const body = await bodyOf(res)
      expect(body.members.find((m: any) => m.id === 'child-a')).toMatchObject({ color: 'orange', custom: true })

      await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'child-a': null } } }))
      expect(db.find('user', 'child-a')!.board_color).toBeNull()
    })

    it("refuses another household's member exactly like a missing one, writing nothing", async () => {
      const foreign = await settings.PATCH(
        req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'child-a': 'pink', 'child-b': 'red' } } })
      )
      const missing = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { memberColors: { nobody: 'red' } } }))
      expect(foreign.status).toBe(400)
      expect(missing.status).toBe(400)
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing))
      expect(db.find('user', 'child-b')!.board_color).toBeUndefined()
      expect(db.find('user', 'child-a')!.board_color).toBeUndefined()
      expect(writesTo('user')).toHaveLength(0)
    })

    it('rejects colours outside the palette', async () => {
      const res = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { memberColors: { 'child-a': '#ff0000' } } }))
      expect(res.status).toBe(400)
      expect(writesTo('user')).toHaveLength(0)
    })
  })

  describe('weather', () => {
    it('stores a coarse place, enables weather and drops only this household cache', async () => {
      seedCache(FAMILY_A)
      seedCache(FAMILY_B)
      const res = await settings.PATCH(
        req({
          as: 'parentA',
          method: 'PATCH',
          body: { weather: { place: { label: 'Toronto, Ontario, Canada', latitude: 43.653226, longitude: -79.383184 } } },
        })
      )
      expect(res.status).toBe(200)
      const family = db.find('family', FAMILY_A)!
      expect([family.weather_latitude, family.weather_longitude]).toEqual([43.65, -79.38])
      expect(db.rows('weatherCache').map((r) => r.family_id)).toEqual([FAMILY_B])

      const on = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { weather: { enabled: true, unit: 'fahrenheit' } } }))
      expect(on.status).toBe(200)
      expect((await bodyOf(on)).weather).toEqual({
        available: true,
        enabled: true,
        place: { label: 'Toronto, Ontario, Canada', latitude: 43.65, longitude: -79.38 },
        unit: 'fahrenheit',
      })
      // Household B untouched.
      expect(db.find('family', FAMILY_B)!.weather_enabled).toBeUndefined()
    })

    it('will not turn weather on without a place, or while the server kill switch is off', async () => {
      const noPlace = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { weather: { enabled: true } } }))
      expect(noPlace.status).toBe(400)

      process.env.WEATHER_ENABLED = '0'
      const off = await settings.PATCH(
        req({
          as: 'parentA',
          method: 'PATCH',
          body: { weather: { enabled: true, place: { label: 'Toronto', latitude: 43.65, longitude: -79.38 } } },
        })
      )
      expect(off.status).toBe(409)
      expect(db.find('family', FAMILY_A)!.weather_enabled).toBeUndefined()
    })

    it('removing the place turns weather off', async () => {
      Object.assign(db.find('family', FAMILY_A)!, {
        weather_enabled: true,
        weather_latitude: 43.65,
        weather_longitude: -79.38,
        weather_label: 'Toronto',
      })
      const res = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { weather: { place: null } } }))
      expect(res.status).toBe(200)
      expect(db.find('family', FAMILY_A)).toMatchObject({ weather_enabled: false, weather_latitude: null, weather_label: null })
    })

    it('validates coordinates, labels and unknown keys', async () => {
      for (const body of [
        { weather: { place: { label: 'X', latitude: 91, longitude: 0 } } },
        { weather: { place: { label: 'X', latitude: 0, longitude: -181 } } },
        { weather: { place: { label: '', latitude: 0, longitude: 0 } } },
        { weather: { place: { label: 'X', latitude: '43', longitude: 0 } } },
        { weather: { url: 'http://169.254.169.254/' } },
        { weather: { unit: 'kelvin' } },
      ]) {
        expect((await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body }))).status).toBe(400)
      }
      expect(writesTo('family')).toHaveLength(0)
    })
  })

  describe('place search', () => {
    it('queries only the fixed Open-Meteo geocoding host and rounds coordinates', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { name: 'Toronto', admin1: 'Ontario', country: 'Canada', latitude: 43.70011, longitude: -79.4163 },
              { name: 'Bad', latitude: 'x', longitude: 0 },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      const res = await places.GET(req({ as: 'parentA', query: { q: 'Toronto' } }))
      expect(res.status).toBe(200)
      expect((await bodyOf(res)).places).toEqual([{ label: 'Toronto, Ontario, Canada', latitude: 43.7, longitude: -79.42 }])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const url = new URL(String(fetchSpy.mock.calls[0][0]))
      expect(url.origin).toBe('https://geocoding-api.open-meteo.com')
      expect(url.searchParams.get('name')).toBe('Toronto')
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    })

    it('rejects too-short queries, honours the kill switch, and fails closed on provider errors', async () => {
      expect((await places.GET(req({ as: 'parentA', query: { q: 'T' } }))).status).toBe(400)
      fetchSpy.mockResolvedValue(new Response('oops', { status: 500 }))
      expect((await places.GET(req({ as: 'parentA', query: { q: 'Toronto' } }))).status).toBe(502)
      process.env.WEATHER_ENABLED = 'off'
      fetchSpy.mockClear()
      expect((await places.GET(req({ as: 'parentA', query: { q: 'Toronto' } }))).status).toBe(409)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // #274: the per-household switch for shared-tablet writes (SHARED_DEVICE.md §9.2), default off.
  describe('tablet writes switch', () => {
    const ORIGINAL_DEVICE = process.env.SHARED_DEVICE_ENABLED
    afterEach(() => {
      if (ORIGINAL_DEVICE === undefined) delete process.env.SHARED_DEVICE_ENABLED
      else process.env.SHARED_DEVICE_ENABLED = ORIGINAL_DEVICE
    })

    it('is off by default and reports the server kill switch', async () => {
      delete process.env.SHARED_DEVICE_ENABLED
      expect((await bodyOf(await settings.GET(req({ as: 'parentA' })))).deviceWrites).toEqual({
        available: false,
        enabled: false,
      })
      process.env.SHARED_DEVICE_ENABLED = '1'
      expect((await bodyOf(await settings.GET(req({ as: 'parentA' })))).deviceWrites).toEqual({
        available: true,
        enabled: false,
      })
    })

    it("a parent turns it on for their own household only; a child cannot", async () => {
      const res = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { deviceWrites: { enabled: true } } }))
      expect(res.status).toBe(200)
      expect((await bodyOf(res)).deviceWrites.enabled).toBe(true)
      expect(db.find('family', FAMILY_A)!.device_writes_enabled).toBe(true)
      expect(db.find('family', FAMILY_B)!.device_writes_enabled).toBeUndefined()

      const child = await settings.PATCH(req({ as: 'childA', method: 'PATCH', body: { deviceWrites: { enabled: false } } }))
      expect(child.status).toBe(403)
      expect(db.find('family', FAMILY_A)!.device_writes_enabled).toBe(true)
      const bad = await settings.PATCH(req({ as: 'parentA', method: 'PATCH', body: { deviceWrites: { enabled: 'yes' } } }))
      expect(bad.status).toBe(400)
    })
  })
})
