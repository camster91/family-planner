import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { timingSafeEqualStr } from '@/lib/constant-time'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { isValidTimeZone } from '@/lib/quiet-hours'
import { runMorningSummary } from '@/lib/morning-summary-server'

export const dynamic = 'force-dynamic'

// POST /api/cron/morning-summary[?tz=America/Toronto] — send today's morning
// summary (O-40) to every member who turned it on. Protected exactly like
// /api/cron/recurring-chores: the `x-cron-secret` header must match
// CRON_SECRET; unset is 500 (fail closed), wrong or missing is 401. The secret
// is never logged or echoed.
//
// Nothing in the app calls this. It runs only when the operator schedules it
// (Coolify scheduled task or host cron, docs/runbooks/COOLIFY_DEPLOY.md).
// Safe to retry or double-call: each person gets at most one summary per local
// day (src/lib/morning-summary-server.ts). `tz` is the zone used for members
// who have none saved (else UTC); an unknown zone is 400.
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
    }

    const providedSecret = request.headers.get('x-cron-secret')
    if (!providedSecret || !timingSafeEqualStr(providedSecret, cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let fallbackTimeZone: string | null = null
    const tz = new URL(request.url).searchParams.get('tz')
    if (tz !== null && tz !== '') {
      if (!isValidTimeZone(tz)) {
        return NextResponse.json({ error: 'Unknown time zone' }, { status: 400 })
      }
      fallbackTimeZone = tz
    }

    const result = await runMorningSummary(prisma!, {
      fallbackTimeZone,
      requestId: getRequestId(request),
    })
    return NextResponse.json(result)
  } catch (error) {
    logRouteError('POST /api/cron/morning-summary', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
