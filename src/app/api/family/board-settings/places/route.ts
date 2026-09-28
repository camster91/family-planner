import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { isWeatherEnabled } from '@/lib/weather/board-weather'
import { searchPlaces, WeatherFetchError } from '@/lib/weather/open-meteo'

export const dynamic = 'force-dynamic'

const SEARCH_LIMIT = 30
const SEARCH_WINDOW_MS = 10 * 60 * 1000

/**
 * GET /api/family/board-settings/places?q=Toronto (#262)
 *
 * Place search for the board weather setting. Parent only. The query goes to
 * the fixed Open-Meteo geocoding host only (no user-supplied URL); results
 * carry a display label and coordinates rounded to 2 decimals. Nothing is
 * stored here: the parent saves a chosen place with PATCH /api/family/board-settings.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError
    if (!isWeatherEnabled()) {
      return NextResponse.json({ error: 'Weather is not available on this server' }, { status: 409 })
    }

    const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2 || q.length > 80) {
      return NextResponse.json({ error: 'Type 2 to 80 characters' }, { status: 400 })
    }

    const limit = await checkRateLimit(`weather-places:${auth.user.id}`, SEARCH_LIMIT, SEARCH_WINDOW_MS)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many searches. Try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } }
      )
    }

    try {
      return NextResponse.json({ places: await searchPlaces(q) })
    } catch (err) {
      const code = err instanceof WeatherFetchError ? err.code : 'unknown'
      console.warn('weather.places_failed', code)
      return NextResponse.json({ error: 'Place search is not reachable right now' }, { status: 502 })
    }
  } catch (error) {
    console.error('Place search error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Place search failed' }, { status: 500 })
  }
}
