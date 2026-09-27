/**
 * The write behind PATCH /api/lists/items/update (#162, OFFLINE_SYNC.md
 * "Conflict policy").
 *
 * `checked` is an explicit desired state, never a toggle, and the last request
 * the server receives wins. The compare-and-write runs in one transaction that
 * first locks the item row (`SELECT … FOR UPDATE`), so concurrent requests for
 * the same item are applied one after another in lock order: each one compares
 * against the state its predecessor committed, and its response is the row as
 * it left it. Setting the state the item already has writes nothing, which
 * keeps the original `checked_by` / `checked_at` attribution.
 */
import type { PrismaClient } from '@prisma/client'

export interface ListItemUpdate {
  itemId: string
  checked?: boolean
  content?: string
  quantity?: number
  category?: string
  notes?: string
}

export type ListItemUpdateResult =
  | { status: 200; body: { success: true; item: Record<string, unknown> } }
  | { status: 403 | 404; body: { error: string } }

type Db = Pick<PrismaClient, '$transaction'>

export async function updateListItem(
  db: Db,
  data: ListItemUpdate,
  user: { id: string; family_id: string },
  now: () => Date = () => new Date()
): Promise<ListItemUpdateResult> {
  const { itemId, checked, content, quantity, category, notes } = data
  return db.$transaction(async (tx) => {
    // Serialise writers of this item; a missing row locks nothing and is a 404 below.
    await tx.$queryRaw`SELECT "id" FROM "ListItem" WHERE "id" = ${itemId} FOR UPDATE`
    const item = await tx.listItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { family_id: true } } },
    })
    if (!item) return { status: 404, body: { error: 'Item not found' } }
    if (item.list.family_id !== user.family_id) return { status: 403, body: { error: 'Forbidden' } }

    const updateData: Record<string, unknown> = {}
    // Explicit state, not a toggle. Attribution changes only when the state does.
    if (typeof checked === 'boolean' && checked !== item.checked) {
      updateData.checked = checked
      updateData.checked_by = checked ? user.id : null
      updateData.checked_at = checked ? now() : null
    }
    if (content !== undefined) updateData.content = content
    if (quantity !== undefined) updateData.quantity = quantity
    if (category !== undefined) updateData.category = category
    if (notes !== undefined) updateData.notes = notes

    const { list: _list, ...unchanged } = item
    const updated =
      Object.keys(updateData).length === 0
        ? unchanged
        : await tx.listItem.update({ where: { id: itemId }, data: updateData })
    return { status: 200, body: { success: true, item: updated } }
  })
}
