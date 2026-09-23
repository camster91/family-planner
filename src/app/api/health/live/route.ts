import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Liveness probe — answers only "is this process running and serving HTTP?".
 *
 * It deliberately does NOT touch the database or validate configuration, so a
 * dependency outage is never mistaken for a dead process. Container restart
 * policy should key off this endpoint; deploy readiness should key off
 * `/api/health`, which returns 503 when degraded.
 */
export async function GET() {
  return NextResponse.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    service: 'family-planner-api'
  }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  })
}
