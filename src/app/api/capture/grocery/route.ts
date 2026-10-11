import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { canCreateList } from '@/lib/role-capabilities'
import { resolveDefaultGroceryListInTx } from '@/lib/grocery-from-recipe'
import { createPersonListItemInTx } from '@/lib/person-list-item-create'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const captureGrocerySchema = z.object({
  content: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(9999).default(1),
})

/**
 * Resolve the household grocery list and add the captured item in one keyed
 * transaction. The ordinary default-grocery and item-create routes remain
 * unchanged for existing clients.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate
    if (!canCreateList(auth.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = captureGrocerySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId: auth.user.family_id, userId: auth.user.id, action: 'capture.grocery.add' },
      parsed.data,
      ({ recordId }) =>
        prisma!.$transaction(async (tx) => {
          const list = await resolveDefaultGroceryListInTx(tx, auth.user.family_id, auth.user.id)
          return createPersonListItemInTx(
            tx,
            { listId: list.id, content: parsed.data.content, quantity: parsed.data.quantity },
            { familyId: auth.user.family_id, addedBy: auth.user.id },
            recordId,
            { groceryOnly: true },
          )
        }),
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logRouteError('POST /api/capture/grocery', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
