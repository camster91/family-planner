/**
 * Open-Meteo client for the Today board weather tile (#262).
 *
 * Server-side only. SSRF-safe by construction: the only hosts ever contacted
 * are the two fixed Open-Meteo endpoints below; no part of a URL comes from a
 * user except numeric coordinates (validated and rounded) and a search string
 * (sent as an encoded query parameter). Redirects are refused, every request
 * has a short timeout and a response size cap, and there are no retries: the
 * caller caches failures (src/lib/weather/board-weather.ts).
 *
 * Open-Meteo needs no API key; nothing secret is sent. Errors carry a fixed
 * code only, never coordinates or a response body.
 */

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/** Short: the board renders while this runs on a cache miss. */
export const WEATHER_TIMEOUT_MS = 3_000
export const MAX_RESPONSE_BYTES = 128 * 1024
/** Today plus the next three days, matching the board's "Coming up". */
export const FORECAST_DAYS = 4

export type WeatherErrorCode = 'timeout' | 'network' | 'http_error' | 'too_large' | 'bad_response'

export class WeatherFetchError extends Error {
  constructor(public readonly code: WeatherErrorCode) {
    super(`weather ${code}`)
    this.name = 'WeatherFetchError'
  }
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

/** Normalized forecast as cached (always Celsius; conversion happens on read). */
export interface WeatherSnapshot {
  current: { temperatureC: number; code: number; isDay: boolean }
  /** Location-local calendar days (`YYYY-MM-DD`), soonest first. */
  daily: Array<{ day: string; highC: number; lowC: number; code: number; precipitationChance: number | null }>
  /**
   * The place's UTC offset when fetched (`timezone=auto`), so "today" in the
   * daily rows is the PLACE's date, not the viewer's or the server's.
   */
  utcOffsetSeconds: number
  /** IANA zone Open-Meteo resolved for the place, when given (informational). */
  timezone: string | null
}

/** Real UTC offsets are within -12h..+14h; allow a margin. */
const MAX_OFFSET_SECONDS = 15 * 60 * 60

export interface PlaceResult {
  /** "Toronto, Ontario, Canada" (no street-level detail exists in this API). */
  label: string
  latitude: number
  longitude: number
}

/** Rounds to 2 decimals (about 1 km): the only precision ever stored or sent. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180
}

async function getJson(url: URL, fetchImpl: FetchImpl, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
    } catch (err) {
      if (controller.signal.aborted) throw new WeatherFetchError('timeout')
      throw new WeatherFetchError(err instanceof WeatherFetchError ? err.code : 'network')
    }
    if (!res.ok) throw new WeatherFetchError('http_error')
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new WeatherFetchError('too_large')
    let text: string
    try {
      text = await res.text()
    } catch {
      throw new WeatherFetchError(controller.signal.aborted ? 'timeout' : 'network')
    }
    if (text.length > MAX_RESPONSE_BYTES) throw new WeatherFetchError('too_large')
    try {
      return JSON.parse(text)
    } catch {
      throw new WeatherFetchError('bad_response')
    }
  } finally {
    clearTimeout(timer)
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Validates and normalizes an Open-Meteo forecast body. Throws `bad_response`. */
export function parseForecast(body: unknown): WeatherSnapshot {
  const b = body as {
    utc_offset_seconds?: unknown
    timezone?: unknown
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown }
    daily?: {
      time?: unknown
      weather_code?: unknown
      temperature_2m_max?: unknown
      temperature_2m_min?: unknown
      precipitation_probability_max?: unknown
    }
  }
  const temp = num(b?.current?.temperature_2m)
  const code = num(b?.current?.weather_code)
  if (temp === null || code === null) throw new WeatherFetchError('bad_response')
  const offset = num(b?.utc_offset_seconds)
  if (offset === null || Math.abs(offset) > MAX_OFFSET_SECONDS) throw new WeatherFetchError('bad_response')
  const timezone = typeof b.timezone === 'string' && b.timezone.length <= 64 ? b.timezone : null
  const d = b.daily
  const times = Array.isArray(d?.time) ? d!.time : []
  const codes = Array.isArray(d?.weather_code) ? d!.weather_code : []
  const highs = Array.isArray(d?.temperature_2m_max) ? d!.temperature_2m_max : []
  const lows = Array.isArray(d?.temperature_2m_min) ? d!.temperature_2m_min : []
  const precip = Array.isArray(d?.precipitation_probability_max) ? d!.precipitation_probability_max : []
  const daily: WeatherSnapshot['daily'] = []
  for (let i = 0; i < Math.min(times.length, FORECAST_DAYS); i++) {
    const day = times[i]
    const high = num(highs[i])
    const low = num(lows[i])
    const dayCode = num(codes[i])
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || high === null || low === null || dayCode === null) {
      continue
    }
    const p = num(precip[i])
    daily.push({ day, highC: high, lowC: low, code: dayCode, precipitationChance: p === null ? null : Math.max(0, Math.min(100, p)) })
  }
  if (daily.length === 0) throw new WeatherFetchError('bad_response')
  return {
    current: { temperatureC: temp, code, isDay: b.current?.is_day !== 0 },
    daily,
    utcOffsetSeconds: offset,
    timezone,
  }
}

export async function fetchForecast(
  latitude: number,
  longitude: number,
  { fetchImpl = fetch, timeoutMs = WEATHER_TIMEOUT_MS }: { fetchImpl?: FetchImpl; timeoutMs?: number } = {}
): Promise<WeatherSnapshot> {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) throw new WeatherFetchError('bad_response')
  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', roundCoordinate(latitude).toFixed(2))
  url.searchParams.set('longitude', roundCoordinate(longitude).toFixed(2))
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(FORECAST_DAYS))
  return parseForecast(await getJson(url, fetchImpl, timeoutMs))
}

/** Place search for the settings form. Coordinates come back already rounded. */
export async function searchPlaces(
  query: string,
  { fetchImpl = fetch, timeoutMs = WEATHER_TIMEOUT_MS }: { fetchImpl?: FetchImpl; timeoutMs?: number } = {}
): Promise<PlaceResult[]> {
  const url = new URL(GEOCODING_URL)
  url.searchParams.set('name', query)
  url.searchParams.set('count', '6')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  const body = (await getJson(url, fetchImpl, timeoutMs)) as { results?: unknown }
  const results = Array.isArray(body?.results) ? body.results : []
  const out: PlaceResult[] = []
  const seen = new Set<string>()
  for (const r of results as Array<Record<string, unknown>>) {
    const lat = num(r?.latitude)
    const lon = num(r?.longitude)
    const name = typeof r?.name === 'string' ? r.name.trim() : ''
    if (lat === null || lon === null || !isValidLatitude(lat) || !isValidLongitude(lon) || !name) continue
    const parts = [name, r.admin1, r.country]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim())
    const label = [...new Set(parts)].join(', ').slice(0, 80)
    const place = { label, latitude: roundCoordinate(lat), longitude: roundCoordinate(lon) }
    const key = `${place.label}|${place.latitude}|${place.longitude}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(place)
  }
  return out
}
