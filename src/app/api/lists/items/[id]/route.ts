import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { deletePersonListItem } from '@/lib/list-item-delete'
import { authorizePersonListItemInTx } from '@/lib/person-list-item-authority'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Exact, list-scoped delete reconciliation. `missing` is only authoritative
 * after the caller's list is proved to be in the caller's household;
 * inaccessible list scope remains `held` so a client never turns privacy into
 * a false deletion result.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const { id } = await context.params
    const listId = request.nextUrl.searchParams.get('listId')
    const expectedUserId = request.nextUrl.searchParams.get('userId')
    const expectedGeneration = request.nextUrl.searchParams.get('generation')
    const parsedGeneration = expectedGeneration === null ? null : Number(expectedGeneration)
    if (
      !id ||
      !listId ||
      !expectedUserId ||
      request.nextUrl.searchParams.getAll('listId').length !== 1 ||
      request.nextUrl.searchParams.getAll('userId').length !== 1 ||
      request.nextUrl.searchParams.getAll('generation').length !== 1 ||
      typeof parsedGeneration !== 'number' ||
      !Number.isSafeInteger(parsedGeneration) ||
      parsedGeneration < 0 ||
      auth.payload.userId !== expectedUserId ||
      (auth.payload.tv ?? 0) !== parsedGeneration
    ) {
      return NextResponse.json(
        { state: 'held' },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
    const generation = parsedGeneration

    const state = await prisma!.$transaction(async tx => {
      const denied = await authorizePersonListItemInTx(tx, {
        familyId: auth.user.family_id,
        addedBy: expectedUserId,
        role: auth.user.role,
        generation,
      }, {})
      if (denied) return 'held' as const
      const list = await tx.list.findFirst({
        where: { id: listId, family_id: auth.user.family_id },
        select: { id: true },
      })
      if (!list) return 'held' as const
      const item = await tx.listItem.findFirst({
        where: { id, list_id: list.id },
        select: { id: true },
      })
      return item ? 'found' as const : 'missing' as const
    })
    return NextResponse.json(
      { state },
      { status: state === 'held' ? 409 : 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    logRouteError('GET /api/lists/items/[id]', error, getRequestId(request))
    return NextResponse.json(
      { state: 'held' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}

/**
 * DELETE /api/lists/items/[id] (route inventory F-6, #289): the REST form of
 * `DELETE /api/lists/items/delete?itemId=`, which stays for installed Android
 * builds. Same rules through the same helper (`deletePersonListItem`):
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
    if (!id)
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    const result = await deletePersonListItem(prisma!, id, {
      familyId: auth.user.family_id,
      addedBy: auth.user.id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    })
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    logRouteError('DELETE /api/lists/items/[id]', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
