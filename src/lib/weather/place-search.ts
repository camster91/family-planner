/**
 * Place search for the board weather setting (#262), shared by
 * GET /api/family/board-settings/places (parent person session) and
 * GET /api/device/elevated/board-settings/places (elevated tablet, #274).
 *
 * The query goes to the fixed Open-Meteo geocoding host only (no
 * user-supplied URL); results carry a display label and coordinates rounded
 * to 2 decimals. Nothing is stored here: the parent saves a chosen place with
 * the board-settings PATCH.
 */
import { checkRateLimit } from '@/lib/rate-limit-db'
import { isWeatherEnabled } from '@/lib/weather/board-weather'
import { searchPlaces, WeatherFetchError } from '@/lib/weather/open-meteo'

export const PLACE_SEARCH_LIMIT = 30
export const PLACE_SEARCH_WINDOW_MS = 10 * 60 * 1000

export type PlaceSearchOutcome =
  | { ok: true; places: Awaited<ReturnType<typeof searchPlaces>> }
  | { ok: false; status: 400 | 409 | 429 | 502; error: string; retryAfterSeconds?: number }

/** `rateKey` names the caller: `weather-places:<userId>` or `weather-places:device:<deviceId>`. */
export async function runPlaceSearch(rawQuery: string | null, rateKey: string): Promise<PlaceSearchOutcome> {
  if (!isWeatherEnabled()) return { ok: false, status: 409, error: 'Weather is not available on this server' }
  const q = (rawQuery ?? '').trim()
  if (q.length < 2 || q.length > 80) return { ok: false, status: 400, error: 'Type 2 to 80 characters' }

  const limit = await checkRateLimit(rateKey, PLACE_SEARCH_LIMIT, PLACE_SEARCH_WINDOW_MS)
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many searches. Try again in a few minutes.',
      retryAfterSeconds: Math.max(1, Math.ceil(limit.retryAfterMs / 1000)),
    }
  }
  try {
    return { ok: true, places: await searchPlaces(q) }
  } catch (err) {
    const code = err instanceof WeatherFetchError ? err.code : 'unknown'
    console.warn('weather.places_failed', code)
    return { ok: false, status: 502, error: 'Place search is not reachable right now' }
  }
}
