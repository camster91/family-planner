import { PRIVATE_TIMELINE_ACTIONS } from "@/lib/review-inbox/timeline-contract";
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { legacyAnalyticsTypeFilter, pruneLegacyAnalytics } from '@/lib/legacy-analytics'

export const dynamic = 'force-dynamic'

// GET - Family activity feed
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')
    const rawLimit = searchParams.get('limit')
    let limit = 30
    if (rawLimit !== null && rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit.trim())) {
        return NextResponse.json({ error: 'limit must be a whole number' }, { status: 400 })
      }
      // Clamp to 1..100 rather than refusing an out-of-range page size.
      limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 100)
    }
    let before: Date | null = null
    if (cursor) {
      before = new Date(cursor)
      if (Number.isNaN(before.getTime())) {
        return NextResponse.json({ error: 'cursor must be a valid date-time' }, { status: 400 })
      }
    }

    const where: Record<string, unknown> = {
      family_id: auth.user.family_id,
      // Exclude legacy analytics rows (which share the Activity model). The
      // shared filter escapes the LIKE wildcard so real rows such as
      // `event_created` and `events_imported` stay in the feed.
      type: { not: legacyAnalyticsTypeFilter(), notIn: [...PRIVATE_TIMELINE_ACTIONS] },
    }
    if (before) {
      where.created_at = { lt: before }
    }

    // Housekeeping: drop this household's legacy analytics rows past retention (#136).
    await pruneLegacyAnalytics(prisma!, auth.user.family_id)

    const activities = await prisma!.activity.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    // New read-proof/actor markers belong to the parent timeline, not the old
    // all-member activity DTO. Older metadata remains compatible.
    const publicActivities = activities.map(row => {
      if (!row.metadata) return row;
      try { if (JSON.parse(row.metadata)?.timeline === 1) return {...row, metadata: null}; }
      catch { /* Existing malformed metadata is not a new timeline marker. */ }
      return row;
    })
    return NextResponse.json({ activities: publicActivities }, {headers: {"Cache-Control": "private, no-store"}})
  } catch (error) {
    logRouteError('GET /api/activity', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
