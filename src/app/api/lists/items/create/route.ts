import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createListItemSchema } from '@/lib/validations'
import { createPersonListItem } from '@/lib/person-list-item-create'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * POST /api/lists/items/create. The write is `createListItem`
 * (src/lib/list-item-create.ts), shared with the paired tablet's quick add
 * (POST /api/device/lists/:id/items, #274).
 * Optional Idempotency-Key (#135): person-list-item-create commits the item
 * and completed replay response atomically. No-key clients keep distinct adds.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createListItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // Verify list belongs to user's family (a foreign list keeps its 403).
    const list = await prisma!.list.findUnique({
      where: { id: parsed.data.listId },
      select: { family_id: true },
    })
    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }
    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    return await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId: auth.user.family_id, userId: auth.user.id, action: 'list-item.add' },
      parsed.data,
      ({ recordId }) =>
        createPersonListItem(prisma!, parsed.data, { familyId: auth.user.family_id, addedBy: auth.user.id }, recordId)
    )
  } catch (error) {
    logRouteError('POST /api/lists/items/create', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
