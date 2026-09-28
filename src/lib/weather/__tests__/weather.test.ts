import {
  FORECAST_URL,
  fetchForecast,
  parseForecast,
  roundCoordinate,
  searchPlaces,
  WeatherFetchError,
} from '../open-meteo'
import {
  WEATHER_CACHE_TTL_MS,
  WEATHER_ERROR_BACKOFF_MS,
  __resetWeatherInflight,
  getBoardWeather,
  isWeatherEnabled,
  toBoardWeather,
} from '../board-weather'
import { describeWeatherCode } from '../codes'

const NOW = new Date('2026-01-05T12:00:00Z')

const FORECAST_BODY = {
  current: { temperature_2m: -3.4, weather_code: 71, is_day: 1 },
  daily: {
    time: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
    weather_code: [71, 3, 0, 61],
    temperature_2m_max: [-1.2, 2.6, 4, 5],
    temperature_2m_min: [-8.5, -4, -2, 1],
    precipitation_probability_max: [80, 10, 0, null],
  },
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('open-meteo client', () => {
  it('rounds coordinates to 2 decimals', () => {
    expect(roundCoordinate(43.653226)).toBe(43.65)
    expect(roundCoordinate(-79.383184)).toBe(-79.38)
  })

  it('requests only the fixed forecast host with rounded coordinates, no redirects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(FORECAST_BODY))
    const snap = await fetchForecast(43.653226, -79.383184, { fetchImpl })
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(`${url.origin}${url.pathname}`).toBe(FORECAST_URL)
    expect(url.searchParams.get('latitude')).toBe('43.65')
    expect(url.searchParams.get('longitude')).toBe('-79.38')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'GET' })
    expect(snap.current).toEqual({ temperatureC: -3.4, code: 71, isDay: true })
    expect(snap.daily).toHaveLength(4)
    expect(snap.daily[3].precipitationChance).toBeNull()
  })

  it.each([
    ['http error', () => Promise.resolve(new Response('x', { status: 503 })), 'http_error'],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'network'],
    ['not json', () => Promise.resolve(new Response('<html>', { status: 200 })), 'bad_response'],
    ['wrong shape', () => Promise.resolve(jsonResponse({ current: {} })), 'bad_response'],
    [
      'too large',
      () => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } })),
      'too_large',
    ],
  ])('fails with a fixed code on %s', async (_label, impl, code) => {
    await expect(fetchForecast(1, 1, { fetchImpl: jest.fn(impl as any) })).rejects.toMatchObject({ code })
  })

  it('times out quickly instead of hanging', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    await expect(fetchForecast(1, 1, { fetchImpl, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('refuses invalid coordinates without a request', async () => {
    const fetchImpl = jest.fn()
    await expect(fetchForecast(95, 0, { fetchImpl })).rejects.toBeInstanceOf(WeatherFetchError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('parses daily rows defensively (skips malformed days)', () => {
    const snap = parseForecast({
      current: { temperature_2m: 1, weather_code: 0, is_day: 0 },
      daily: { time: ['2026-01-05', 'bad'], weather_code: [0, 0], temperature_2m_max: [3, 3], temperature_2m_min: [1, 1] },
    })
    expect(snap.daily.map((d) => d.day)).toEqual(['2026-01-05'])
    expect(snap.current.isDay).toBe(false)
  })

  it('place search: encoded query to the geocoding host, labels deduplicated, coordinates rounded', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { name: 'London', admin1: 'England', country: 'United Kingdom', latitude: 51.50853, longitude: -0.12574 },
          { name: 'London', admin1: 'Ontario', country: 'Canada', latitude: 42.98339, longitude: -81.23304 },
          { name: 'London', admin1: 'Ontario', country: 'Canada', latitude: 42.98339, longitude: -81.23304 },
        ],
      })
    )
    const out = await searchPlaces('London & co', { fetchImpl })
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.host).toBe('geocoding-api.open-meteo.com')
    expect(url.searchParams.get('name')).toBe('London & co')
    expect(out).toEqual([
      { label: 'London, England, United Kingdom', latitude: 51.51, longitude: -0.13 },
      { label: 'London, Ontario, Canada', latitude: 42.98, longitude: -81.23 },
    ])
  })
})

describe('weather codes', () => {
  it('describes known codes and falls back for unknown ones', () => {
    expect(describeWeatherCode(0)).toEqual({ summary: 'Clear', icon: 'clear' })
    expect(describeWeatherCode(95).icon).toBe('storm')
    expect(describeWeatherCode(1234).summary).toBe('Mixed conditions')
  })
})

describe('kill switch', () => {
  it('is on unless explicitly turned off', () => {
    expect(isWeatherEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true)
    expect(isWeatherEnabled({ WEATHER_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true)
    for (const off of ['false', '0', 'off', 'NO', ' False ']) {
      expect(isWeatherEnabled({ WEATHER_ENABLED: off } as unknown as NodeJS.ProcessEnv)).toBe(false)
    }
  })
})

describe('toBoardWeather', () => {
  it('converts to Fahrenheit and rounds whole degrees', () => {
    const snap = parseForecast(FORECAST_BODY)
    const c = toBoardWeather(snap, 'Toronto', 'celsius', NOW)
    const f = toBoardWeather(snap, 'Toronto', 'fahrenheit', NOW)
    expect(c.current).toMatchObject({ temperature: -3, summary: 'Light snow', icon: 'snow' })
    expect(c.unit).toBe('C')
    expect(f.unit).toBe('F')
    expect(f.current.temperature).toBe(26)
    expect(f.days[0]).toMatchObject({ high: 30, low: 17, precipitationChance: 80 })
  })
})

describe('getBoardWeather (cache, backoff, fail closed)', () => {
  const ORIGINAL = process.env.WEATHER_ENABLED
  let warn: jest.SpyInstance
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    delete process.env.WEATHER_ENABLED
    __resetWeatherInflight()
  })
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.WEATHER_ENABLED
    else process.env.WEATHER_ENABLED = ORIGINAL
    warn.mockRestore()
  })

  function makeDb(
    family: Record<string, unknown> | null = {
      weather_enabled: true,
      weather_latitude: 43.65,
      weather_longitude: -79.38,
      weather_label: 'Toronto',
      weather_unit: 'celsius',
    },
    cache: Record<string, unknown> | null = null
  ) {
    let row = cache
    return {
      family: { findUnique: jest.fn().mockResolvedValue(family) },
      weatherCache: {
        findUnique: jest.fn(async (_args: any) => row),
        upsert: jest.fn(async (args: any) => {
          row = { ...args.create }
          return row
        }),
      },
      get row() {
        return row
      },
    }
  }

  const okCache = (ageMs: number, extra: Record<string, unknown> = {}) => ({
    latitude: 43.65,
    longitude: -79.38,
    status: 'ok',
    payload: parseForecast(FORECAST_BODY),
    fetched_at: new Date(NOW.getTime() - ageMs),
    ...extra,
  })

  it('is null without any read when the kill switch is off', async () => {
    process.env.WEATHER_ENABLED = 'false'
    const db = makeDb()
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: NOW })).toBeNull()
    expect(db.family.findUnique).not.toHaveBeenCalled()
  })

  it('is null without a request when the household has not opted in (the default)', async () => {
    const fetchImpl = jest.fn()
    const db = makeDb({ weather_enabled: false, weather_latitude: 43.65, weather_longitude: -79.38 })
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })).toBeNull()
    expect(db.weatherCache.findUnique).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.family.findUnique.mock.calls[0][0].where).toEqual({ id: 'fam' })
  })

  it('serves a fresh cache row without a request', async () => {
    const fetchImpl = jest.fn()
    const db = makeDb(undefined, okCache(WEATHER_CACHE_TTL_MS - 1000))
    const w = await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    expect(w).toMatchObject({ label: 'Toronto', current: { temperature: -3 } })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.weatherCache.findUnique.mock.calls[0][0].where).toEqual({ family_id: 'fam' })
  })

  it('refetches a stale row and stores the result', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(FORECAST_BODY))
    const db = makeDb(undefined, okCache(WEATHER_CACHE_TTL_MS + 1000))
    const w = await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    expect(w?.fetchedAt).toBe(NOW.toISOString())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(db.weatherCache.upsert.mock.calls[0][0]).toMatchObject({
      where: { family_id: 'fam' },
      update: { status: 'ok', latitude: 43.65, longitude: -79.38 },
    })
  })

  it('refetches when the place changed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(FORECAST_BODY))
    const db = makeDb(undefined, okCache(1000, { latitude: 51.5 }))
    await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats a row stamped far in the future (clock jump) as stale', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(FORECAST_BODY))
    const db = makeDb(undefined, okCache(-3 * 24 * 60 * 60 * 1000))
    await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails closed on a provider error, records it, and backs off without retrying', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('down', { status: 503 }))
    const db = makeDb()
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })).toBeNull()
    expect(db.row).toMatchObject({ status: 'error', family_id: 'fam' })

    // Within the backoff window: no new request.
    const soon = new Date(NOW.getTime() + WEATHER_ERROR_BACKOFF_MS - 1000)
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: soon, fetchImpl })).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // After it: one new attempt.
    fetchImpl.mockResolvedValue(jsonResponse(FORECAST_BODY))
    const later = new Date(NOW.getTime() + WEATHER_ERROR_BACKOFF_MS + 1000)
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: later, fetchImpl })).not.toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one request between concurrent misses for a household', async () => {
    let resolve!: (r: Response) => void
    const fetchImpl = jest.fn(() => new Promise<Response>((r) => (resolve = r)))
    const db = makeDb()
    const a = getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    const b = getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    await new Promise((r) => setTimeout(r, 0))
    resolve(jsonResponse(FORECAST_BODY))
    const [wa, wb] = await Promise.all([a, b])
    expect(wa).not.toBeNull()
    expect(wb).toEqual(wa)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never throws: a database error hides the tile', async () => {
    const db = makeDb()
    db.family.findUnique.mockRejectedValue(new Error('db down'))
    expect(await getBoardWeather(db as any, { familyId: 'fam', now: NOW })).toBeNull()
  })

  it('never logs the coordinates or the place', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('boom 43.65'))
    const db = makeDb()
    await getBoardWeather(db as any, { familyId: 'fam', now: NOW, fetchImpl })
    const logged = JSON.stringify([...warn.mock.calls, ...(console.log as jest.Mock).mock.calls])
    expect(logged).not.toContain('43.65')
    expect(logged).not.toContain('Toronto')
  })
})
