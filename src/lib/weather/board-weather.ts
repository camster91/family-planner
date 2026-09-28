/**
 * Today board weather (#262): household opt-in, per-household cache, fail closed.
 *
 * - Off unless the household turned it on (`Family.weather_enabled`, default
 *   false) AND the server kill switch allows it (`WEATHER_ENABLED`, off unless
 *   explicitly set to `1` or `true`). With either off nothing is read or fetched.
 * - Only the stored coarse place (2-decimal coordinates) is sent, and only to
 *   Open-Meteo (src/lib/weather/open-meteo.ts).
 * - One `WeatherCache` row per household. A fresh 'ok' row (< 30 min) is served
 *   without a request; a recent 'error' row (< 10 min) hides the tile without a
 *   request, so a provider outage never turns every board refresh into a
 *   retry. Concurrent misses for the same household share one request.
 * - Every failure (disabled, timeout, bad response, database error) returns
 *   null: the board hides the tile and nothing else changes.
 *
 * Refreshed by viewing the board (person page or GET /api/device/today); there
 * is no scheduled job.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { log } from '@/lib/logger'
import {
  fetchForecast,
  isValidLatitude,
  isValidLongitude,
  roundCoordinate,
  WeatherFetchError,
  type FetchImpl,
  type WeatherSnapshot,
} from './open-meteo'
import { describeWeatherCode, type WeatherIconKind } from './codes'

export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000
export const WEATHER_ERROR_BACKOFF_MS = 10 * 60 * 1000
/** A cache row stamped further in the future than this is treated as stale (clock jump). */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

export type WeatherUnit = 'celsius' | 'fahrenheit'

export function isWeatherUnit(value: unknown): value is WeatherUnit {
  return value === 'celsius' || value === 'fahrenheit'
}

/**
 * Server kill switch. Default OFF: only an explicit `WEATHER_ENABLED=1` or
 * `true` (any case) enables it, so a deployment that never set it sends
 * nothing to Open-Meteo. Households still have to opt in on top.
 */
export function isWeatherEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.WEATHER_ENABLED ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

/** Board DTO part. Temperatures are whole degrees in `unit`. */
export interface BoardWeather {
  /** The place label a parent chose, e.g. "Toronto, Ontario, Canada". */
  label: string
  unit: 'C' | 'F'
  current: { temperature: number; summary: string; icon: WeatherIconKind; isDay: boolean }
  /** Location-local days from today, soonest first (at most 4). */
  days: Array<{
    day: string
    high: number
    low: number
    summary: string
    icon: WeatherIconKind
    /** Highest chance of precipitation that day, 0–100, when known. */
    precipitationChance: number | null
  }>
  /**
   * The place's UTC offset in seconds. The client picks "today" among `days`
   * by the place's current date (now + offset), not the viewer's zone.
   * Optional for boards built before this field.
   */
  utcOffsetSeconds?: number
  /** When the forecast was fetched from Open-Meteo (server clock, ISO). */
  fetchedAt: string
}

type Db = Pick<PrismaClient, 'family' | 'weatherCache'>

function isSnapshot(value: unknown): value is WeatherSnapshot {
  const v = value as WeatherSnapshot
  return (
    !!v &&
    typeof v.current?.temperatureC === 'number' &&
    typeof v.current?.code === 'number' &&
    // Rows cached before the place's offset was stored are treated as stale
    // and refetched, so day selection always uses the place's date.
    typeof v.utcOffsetSeconds === 'number' &&
    Array.isArray(v.daily) &&
    v.daily.length > 0 &&
    v.daily.every((d) => typeof d?.day === 'string' && typeof d.highC === 'number' && typeof d.lowC === 'number')
  )
}

function convert(celsius: number, unit: WeatherUnit): number {
  return Math.round(unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius)
}

export function toBoardWeather(snapshot: WeatherSnapshot, label: string, unit: WeatherUnit, fetchedAt: Date): BoardWeather {
  const current = describeWeatherCode(snapshot.current.code)
  return {
    label,
    unit: unit === 'fahrenheit' ? 'F' : 'C',
    current: {
      temperature: convert(snapshot.current.temperatureC, unit),
      summary: current.summary,
      icon: current.icon,
      isDay: snapshot.current.isDay,
    },
    days: snapshot.daily.map((d) => {
      const info = describeWeatherCode(d.code)
      return {
        day: d.day,
        high: convert(d.highC, unit),
        low: convert(d.lowC, unit),
        summary: info.summary,
        icon: info.icon,
        precipitationChance: typeof d.precipitationChance === 'number' ? Math.round(d.precipitationChance) : null,
      }
    }),
    utcOffsetSeconds: snapshot.utcOffsetSeconds,
    fetchedAt: fetchedAt.toISOString(),
  }
}

/** One in-flight Open-Meteo request per household and place. */
const inflight = new Map<string, Promise<WeatherSnapshot | null>>()

async function refresh(
  db: Db,
  familyId: string,
  latitude: number,
  longitude: number,
  now: Date,
  fetchImpl: FetchImpl | undefined
): Promise<WeatherSnapshot | null> {
  const key = `${familyId}|${latitude}|${longitude}`
  const pending = inflight.get(key)
  if (pending) return pending
  const run = (async () => {
    let snapshot: WeatherSnapshot | null = null
    try {
      snapshot = await fetchForecast(latitude, longitude, fetchImpl ? { fetchImpl } : {})
    } catch (error) {
      // Fixed code only: no coordinates, label or body in logs.
      log.warn('weather.fetch_failed', { code: error instanceof WeatherFetchError ? error.code : 'unknown' })
    }
    const row = {
      latitude,
      longitude,
      status: snapshot ? 'ok' : 'error',
      payload: snapshot ? (snapshot as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
      fetched_at: now,
    }
    try {
      await db.weatherCache.upsert({
        where: { family_id: familyId },
        create: { family_id: familyId, ...row },
        update: row,
      })
    } catch (error) {
      log.warn('weather.cache_write_failed', { message: error instanceof Error ? error.message : String(error) })
    }
    return snapshot
  })()
  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}

/**
 * The household's weather for the board, or null (off, not configured, or
 * unavailable). Never throws.
 */
export async function getBoardWeather(
  db: Db,
  { familyId, now = new Date(), fetchImpl }: { familyId: string; now?: Date; fetchImpl?: FetchImpl }
): Promise<BoardWeather | null> {
  if (!isWeatherEnabled()) return null
  try {
    const family = await db.family.findUnique({
      where: { id: familyId },
      select: {
        weather_enabled: true,
        weather_latitude: true,
        weather_longitude: true,
        weather_label: true,
        weather_unit: true,
      },
    })
    if (!family?.weather_enabled) return null
    if (!isValidLatitude(family.weather_latitude) || !isValidLongitude(family.weather_longitude)) return null
    const latitude = roundCoordinate(family.weather_latitude)
    const longitude = roundCoordinate(family.weather_longitude)
    const label = family.weather_label?.trim() || 'Weather'
    const unit: WeatherUnit = isWeatherUnit(family.weather_unit) ? family.weather_unit : 'celsius'

    const cache = await db.weatherCache.findUnique({
      where: { family_id: familyId },
      select: { latitude: true, longitude: true, status: true, payload: true, fetched_at: true },
    })
    if (cache && cache.latitude === latitude && cache.longitude === longitude) {
      const age = now.getTime() - cache.fetched_at.getTime()
      if (age > -MAX_FUTURE_SKEW_MS) {
        if (cache.status === 'ok' && age < WEATHER_CACHE_TTL_MS && isSnapshot(cache.payload)) {
          return toBoardWeather(cache.payload, label, unit, cache.fetched_at)
        }
        if (cache.status === 'error' && age < WEATHER_ERROR_BACKOFF_MS) return null
      }
    }

    const snapshot = await refresh(db, familyId, latitude, longitude, now, fetchImpl)
    return snapshot ? toBoardWeather(snapshot, label, unit, now) : null
  } catch (error) {
    log.warn('weather.board_failed', { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

/** Test hook: forget in-flight requests between tests. */
export function __resetWeatherInflight() {
  inflight.clear()
}
