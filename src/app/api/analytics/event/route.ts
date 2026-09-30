import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerUser } from '@/lib/supabase/server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { pruneLegacyAnalytics } from '@/lib/legacy-analytics'

/**
 * Legacy analytics sink, kept for compatibility (#136, #140).
 *
 * Older web bundles (including open tabs and the Android shell's cached pages)
 * still POST `{ event, path?, metadata? }` here. Nothing is stored any more:
 * the path (which could carry record ids) and client metadata are never read,
 * unknown fields are ignored, and the status codes are unchanged (400 for bad
 * JSON or a missing event name, 200 otherwise, 500 on a server failure). A
 * signed-in household member's request prunes that household's legacy
 * analytics rows past the retention window (`src/lib/legacy-analytics.ts`).
 */
export async function POST(request: NextRequest) {
  try {
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const event = payload && typeof payload === 'object' ? (payload as { event?: unknown }).event : undefined
    if (!event || typeof event !== 'string') {
      return NextResponse.json({ error: 'Event name required' }, { status: 400 })
    }

    // Anonymous visitors are valid: a page_view must not 401 in the console.
    const sessionUser = await getServerUser()
    if (!sessionUser) {
      return NextResponse.json({ success: true, skipped: true, reason: 'anonymous' })
    }

    const user = await prisma!.user.findUnique({
      where: { id: sessionUser.id },
      select: { family_id: true },
    })
    if (!user?.family_id) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no_family' })
    }

    await pruneLegacyAnalytics(prisma!, user.family_id)

    return NextResponse.json({ success: true, skipped: true, reason: 'not_stored' })
  } catch (error) {
    logRouteError('POST /api/analytics/event', error, getRequestId(request))
    return NextResponse.json({ error: 'Failed to log event' }, { status: 500 })
  }
}
