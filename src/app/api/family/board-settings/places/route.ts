import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { runPlaceSearch } from '@/lib/weather/place-search'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * GET /api/family/board-settings/places?q=Toronto (#262)
 *
 * Place search for the board weather setting. Parent only. The query goes to
 * the fixed Open-Meteo geocoding host only (no user-supplied URL); results
 * carry a display label and coordinates rounded to 2 decimals. Nothing is
 * stored here: the parent saves a chosen place with PATCH /api/family/board-settings.
 * Shared with the elevated tablet route through src/lib/weather/place-search.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const result = await runPlaceSearch(request.nextUrl.searchParams.get('q'), `weather-places:${auth.user.id}`)
    if (result.ok) return NextResponse.json({ places: result.places })
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        ...(result.retryAfterSeconds ? { headers: { 'Retry-After': String(result.retryAfterSeconds) } } : {}),
      }
    )
  } catch (error) {
    logRouteError('GET /api/family/board-settings/places', error, getRequestId(request))
    return NextResponse.json({ error: 'Place search failed' }, { status: 500 })
  }
}
