import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { parseAuditQuery, readAuditPage } from '@/lib/household-audit'
import { apiError, logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { withRouteTelemetry } from '@/lib/route-telemetry'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET /api/audit?limit=&cursor= — household audit history (#285, PR101 D-4).
 *
 * Parents only (teen and child 403); a paired shared tablet is refused (403)
 * before person auth. Reads only the caller's household, newest first, and
 * prunes that household's rows older than 12 months first (no scheduled job).
 *
 * 200 `{ entries: [{ id, action, actorKind, actor: { id, name } | null,
 * targetType, targetId, summary, createdAt }], nextCursor }`. `limit` 1–50
 * (default 20); `cursor` is the previous page's opaque `nextCursor`.
 * 400 `INVALID_QUERY` for a bad `limit` or `cursor`; 500 `INTERNAL_ERROR`.
 * Error bodies are `{ error, code, requestId }` (#161, `src/lib/api-error.ts`).
 */
async function getAudit(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const parsed = parseAuditQuery(new URL(request.url).searchParams)
    if (!parsed.ok) return apiError(400, 'INVALID_QUERY', parsed.error, { requestId, headers: NO_STORE })

    const page = await readAuditPage(prisma!, auth.user.family_id, {
      limit: parsed.limit,
      cursor: parsed.cursor,
      now: new Date(),
    })
    return NextResponse.json(page, { headers: NO_STORE })
  } catch (err) {
    logRouteError('GET /api/audit', err, requestId)
    return apiError(500, 'INTERNAL_ERROR', 'Could not load recent changes', { requestId, headers: NO_STORE })
  }
}

export const GET = withRouteTelemetry('/api/audit', getAudit)
