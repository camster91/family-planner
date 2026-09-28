import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { updateListItemSchema } from '@/lib/validations'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { updateListItem } from '@/lib/list-item-update'

export const dynamic = 'force-dynamic'

/** Idempotency action name (#162); part of the stored request hash. */
const LIST_ITEM_UPDATE_ACTION = 'list-item.update'

/**
 * PATCH /api/lists/items/update
 *
 * Accepts an optional `Idempotency-Key` header (#162, API_CONTRACTS.md
 * "Idempotency"): the offline queue replays a tick/untick with the same key
 * and gets the stored result instead of a second write.
 *
 * Convergence (OFFLINE_SYNC.md "Conflict policy"): `checked` is an explicit
 * desired state, never a toggle, and the last write the server receives wins.
 * The compare-and-write is atomic (row lock, `src/lib/list-item-update.ts`):
 * setting an item to the state it already has is a no-op, so a duplicate or a
 * second device making the same change keeps the original `checked_by` /
 * `checked_at` attribution.
 */
export async function PATCH(request: NextRequest) {
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
    const parsed = updateListItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: LIST_ITEM_UPDATE_ACTION,
      },
      parsed.data,
      () => updateListItem(prisma!, parsed.data, auth.user)
    )
  } catch (error) {
    console.error('Error updating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
