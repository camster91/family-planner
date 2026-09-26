import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { updateListItemSchema } from '@/lib/validations'
import { readIdempotencyKey, withIdempotency, type EffectResult } from '@/lib/idempotency'

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
 * Setting an item to the state it already has is a no-op, so a duplicate or a
 * second device making the same change keeps the original `checked_by` /
 * `checked_at` attribution.
 */
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

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
      () => updateItem(parsed.data, auth.user)
    )
  } catch (error) {
    console.error('Error updating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function updateItem(
  data: ReturnType<typeof updateListItemSchema.parse>,
  user: { id: string; family_id: string }
): Promise<EffectResult> {
  const { itemId, checked, content, quantity, category, notes } = data

  // Get the item and verify family access
  const item = await prisma!.listItem.findUnique({
    where: { id: itemId },
    include: { list: { select: { family_id: true } } },
  })

  if (!item) {
    return { status: 404, body: { error: 'Item not found' } }
  }
  if (item.list.family_id !== user.family_id) {
    return { status: 403, body: { error: 'Forbidden' } }
  }

  const updateData: Record<string, unknown> = {}

  // Explicit state, not a toggle. Attribution changes only when the state does.
  if (typeof checked === 'boolean' && checked !== item.checked) {
    updateData.checked = checked
    if (checked) {
      updateData.checked_by = user.id
      updateData.checked_at = new Date()
    } else {
      updateData.checked_by = null
      updateData.checked_at = null
    }
  }

  if (content !== undefined) updateData.content = content
  if (quantity !== undefined) updateData.quantity = quantity
  if (category !== undefined) updateData.category = category
  if (notes !== undefined) updateData.notes = notes

  const { list: _list, ...unchanged } = item
  const updatedItem =
    Object.keys(updateData).length === 0
      ? unchanged
      : await prisma!.listItem.update({
          where: { id: itemId },
          data: updateData,
        })

  return { status: 200, body: { success: true, item: updatedItem } }
}
