import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { deleteHouseholdListItem } from '@/lib/list-item-delete'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/lists/items/[id] (route inventory F-6, #289): the REST form of
 * `DELETE /api/lists/items/delete?itemId=`, which stays for installed Android
 * builds. Same rules through the same helper (`deleteHouseholdListItem`):
 * lists feature on, parent only, the item's list in the caller's household
 * (another household's item is the same 404 as a missing one). A paired shared
 * device is refused before person auth (403 `DEVICE_WRITE_NOT_ALLOWED`), so
 * the new route opens no tablet write. 200 `{ success: true }`.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const refused = await refusePairedDevice(request)
    if (refused) return refused

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await context.params
    if (!id || !(await deleteHouseholdListItem(prisma!, id, auth.user.family_id))) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logRouteError('DELETE /api/lists/items/[id]', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
