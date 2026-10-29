import { getD1Database, type D1Store } from './database'
import {
  WEATHER_CACHE_TTL_MS,
  WEATHER_ERROR_BACKOFF_MS,
  isWeatherUnit,
  toBoardWeather,
  isWeatherEnabled,
  type BoardWeather,
  type WeatherUnit,
} from '@/lib/weather/board-weather'
import {
  fetchForecast,
  isValidLatitude,
  isValidLongitude,
  roundCoordinate,
  type WeatherSnapshot,
} from '@/lib/weather/open-meteo'

type Config = {
  enabled: boolean
  latitude: number
  longitude: number
  label: string | null
  unit: string | null
}

const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

function snapshot(value: unknown): value is WeatherSnapshot {
  const row = value as WeatherSnapshot
  return !!row && typeof row.current?.temperatureC === 'number' && typeof row.current?.code === 'number' &&
    typeof row.utcOffsetSeconds === 'number' && Array.isArray(row.daily) && row.daily.length > 0 &&
    row.daily.every(day => typeof day?.day === 'string' && typeof day.highC === 'number' && typeof day.lowC === 'number')
}

/** D1 weather projection. Reads are primary; refreshes use one explicit native
 * upsert because the board's cache is deliberately best effort and never part
 * of authorization or a board mutation. */
export async function getD1BoardWeather(
  familyId: string,
  now: Date,
  config: Config,
  database?: D1Store,
): Promise<BoardWeather | null> {
  if (!isWeatherEnabled() || !config.enabled || !isValidLatitude(config.latitude) || !isValidLongitude(config.longitude)) return null
  const store = database ?? await getD1Database()
  const db = store.withSession('first-primary')
  const latitude = roundCoordinate(config.latitude), longitude = roundCoordinate(config.longitude)
  const label = config.label?.trim() || 'Weather'
  const unit: WeatherUnit = isWeatherUnit(config.unit) ? config.unit : 'celsius'
  try {
    const cached = await db.prepare(`SELECT latitude,longitude,status,payload,fetched_at FROM "WeatherCache" WHERE family_id=?1`).bind(familyId).first<{ latitude: number; longitude: number; status: string; payload: string | null; fetched_at: number }>()
    if (cached && cached.latitude === latitude && cached.longitude === longitude) {
      const age = now.getTime() - cached.fetched_at
      if (age > -MAX_FUTURE_SKEW_MS) {
        const parsed = cached.payload === null ? null : (() => { try { return JSON.parse(cached.payload) } catch { return null } })()
        if (cached.status === 'ok' && age < WEATHER_CACHE_TTL_MS && snapshot(parsed)) return toBoardWeather(parsed, label, unit, new Date(cached.fetched_at))
        if (cached.status === 'error' && age < WEATHER_ERROR_BACKOFF_MS) return null
      }
    }
    let forecast: WeatherSnapshot | null = null
    try { forecast = await fetchForecast(latitude, longitude) } catch { forecast = null }
    const fetchedAt = now.getTime()
    await db.prepare(`INSERT INTO "WeatherCache" (family_id,latitude,longitude,status,payload,fetched_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(family_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,status=excluded.status,payload=excluded.payload,fetched_at=excluded.fetched_at,updated_at=excluded.updated_at`)
      .bind(familyId, latitude, longitude, forecast ? 'ok' : 'error', forecast ? JSON.stringify(forecast) : null, fetchedAt).run()
    return forecast ? toBoardWeather(forecast, label, unit, now) : null
  } catch {
    return null
  }
}
