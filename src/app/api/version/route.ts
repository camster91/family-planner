import { NextRequest, NextResponse } from 'next/server'
import { getBuildInfo } from '@/lib/build-info'
import { withRouteTelemetry } from '@/lib/route-telemetry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/version (#161): which server build answered.
 *
 * Public, like `/api/health`: 200 `{ version, commit, builtAt }` and nothing
 * else (`src/lib/build-info.ts`). No environment, hostname, database, feature
 * or secret. The request id is in the `X-Request-Id` response header, so a
 * support or test report can quote both.
 */
async function getVersion(_request: NextRequest) {
  return NextResponse.json(getBuildInfo(), { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export const GET = withRouteTelemetry('/api/version', getVersion)
