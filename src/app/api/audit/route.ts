import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { parseAuditQuery, readAuditPage } from '@/lib/household-audit'

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
 * 400 for a bad `limit` or `cursor`.
 */
export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const parsed = parseAuditQuery(new URL(request.url).searchParams)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })

    const page = await readAuditPage(prisma!, auth.user.family_id, {
      limit: parsed.limit,
      cursor: parsed.cursor,
      now: new Date(),
    })
    return NextResponse.json(page, { headers: NO_STORE })
  } catch (err) {
    console.error('Audit history read failed:', err instanceof Error ? err.name : 'unknown error')
    return NextResponse.json({ error: 'Could not load recent changes' }, { status: 500, headers: NO_STORE })
  }
}
