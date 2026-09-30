import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { normalizeFeatures } from '@/lib/features'
import { parseSearchQuery, searchHousehold } from '@/lib/household-search'
import { apiError, logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { withRouteTelemetry } from '@/lib/route-telemetry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/search?q= — household search (route inventory F-3, #101 D-2).
 *
 * Person sessions only: a paired shared tablet is refused before person auth
 * (403, like the other person-only routes that name the device). Every query
 * is scoped to the caller's household; types follow the household's features
 * and the caller's role (`src/lib/household-search.ts`,
 * `docs/ROLE_AND_ISOLATION_MATRIX.md` "Household search").
 *
 * 200 `{ results: [{ type, id, title, subtitle?, href, date? }] }`, at most 5
 * per type and 30 in all, in a fixed order. 400 `QUERY_TOO_SHORT` (under 2
 * characters) or `QUERY_TOO_LONG` (over 100); 500 `INTERNAL_ERROR`. Error
 * bodies are `{ error, code, requestId }` (#161, `src/lib/api-error.ts`).
 */
async function getSearch(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parsed = parseSearchQuery(new URL(request.url).searchParams.get('q'))
    if (!parsed.ok) {
      return apiError(400, parsed.code, parsed.message, { requestId })
    }

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: { features: true },
    })
    const results = await searchHousehold(prisma!, {
      familyId: auth.user.family_id,
      role: auth.user.role,
      features: normalizeFeatures(family?.features),
      q: parsed.q,
    })

    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    // Content-minimal: never log the query text (logRouteError logs name/code only).
    logRouteError('GET /api/search', err, requestId)
    return apiError(500, 'INTERNAL_ERROR', 'Search is not working right now. Try again.', { requestId })
  }
}

export const GET = withRouteTelemetry('/api/search', getSearch)
