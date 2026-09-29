import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { deleteHouseholdListItem } from '@/lib/list-item-delete'
import { DEPRECATED_SINCE_289, markDeprecated } from '@/lib/deprecation'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/lists/items/delete?itemId=<id>. Deprecated (route inventory F-6,
 * #289): the web app calls `DELETE /api/lists/items/[id]`. Kept for installed
 * Android builds until the ADR-0004 old-client review; both routes delete
 * through `deleteHouseholdListItem`. Every response adds a `Deprecation`
 * header (and a `Link` to the REST route when `itemId` is given); status codes
 * and bodies are those of the REST route.
 */
export async function DELETE(request: NextRequest) {
  const itemId = new URL(request.url).searchParams.get('itemId')
  const deprecated = {
    since: DEPRECATED_SINCE_289,
    successor: itemId ? `/api/lists/items/${encodeURIComponent(itemId)}` : undefined,
  }
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return markDeprecated(error, deprecated)

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return markDeprecated(gate, deprecated)

    const parentError = requireParent(auth.user.role)
    if (parentError) return markDeprecated(parentError, deprecated)

    if (!itemId) {
      return markDeprecated(NextResponse.json({ error: 'Missing itemId' }, { status: 400 }), deprecated)
    }

    // Another household's item is the same 404 as a missing one.
    if (!(await deleteHouseholdListItem(prisma!, itemId, auth.user.family_id))) {
      return markDeprecated(NextResponse.json({ error: 'Item not found' }, { status: 404 }), deprecated)
    }

    return markDeprecated(NextResponse.json({ success: true }), deprecated)
  } catch (error) {
    console.error('Error deleting list item:', error)
    return markDeprecated(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), deprecated)
  }
}
