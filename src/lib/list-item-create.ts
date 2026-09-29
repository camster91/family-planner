/**
 * Adding an item to a list: the write behind POST /api/lists/items/create
 * (person session) and POST /api/device/lists/:id/items (paired tablet quick
 * add, #274, SHARED_DEVICE.md §9.2). One function so the rules are not forked.
 *
 * - The list must belong to `familyId`; a foreign and a missing list are the
 *   same `not_found` (the person route keeps its historical 403 for a foreign
 *   list by checking the family itself first).
 * - An `ingredient_id` must be an Ingredient of the same household.
 * - The row goes to the end of the list and is attributed to `addedBy`.
 * - Grocery/shopping lists (#273): the new row carries its resolved store section.
 */
import type { PrismaClient } from '@prisma/client'
import { isGroceryListType } from '@/lib/grocery-display'
import { loadSectionOverrides, sectionsFor } from '@/lib/grocery-section-store'

export interface NewListItem {
  listId: string
  content: string
  quantity?: number
  category?: string
  notes?: string
  amount?: number
  unit?: string
  ingredient_id?: string
}

export type CreateListItemResult =
  | { ok: true; item: Record<string, unknown> }
  | { ok: false; reason: 'list_not_found' | 'ingredient_not_found' | 'not_grocery' }

export async function createListItem(
  db: PrismaClient,
  input: NewListItem,
  actor: { familyId: string; addedBy: string },
  options: { groceryOnly?: boolean } = {}
): Promise<CreateListItemResult> {
  const { listId, content, quantity, category, notes, amount, unit, ingredient_id } = input
  const list = await db.list.findFirst({
    where: { id: listId, family_id: actor.familyId },
    select: { id: true, type: true },
  })
  if (!list) return { ok: false, reason: 'list_not_found' }
  if (options.groceryOnly && !isGroceryListType(list.type)) return { ok: false, reason: 'not_grocery' }

  // An ingredient reference must belong to this household (ADR-0007). A
  // foreign or missing id is the same answer.
  if (ingredient_id) {
    const ingredient = await db.ingredient.findFirst({
      where: { id: ingredient_id, family_id: actor.familyId },
      select: { id: true },
    })
    if (!ingredient) return { ok: false, reason: 'ingredient_not_found' }
  }

  const maxPositionItem = await db.listItem.findFirst({
    where: { list_id: listId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = (maxPositionItem?.position || 0) + 1

  const item = await db.listItem.create({
    data: {
      list_id: listId,
      content,
      quantity: quantity || 1,
      category: category || null,
      notes: notes || null,
      amount: amount ?? null,
      unit: unit ?? null,
      ingredient_id: ingredient_id ?? null,
      added_by: actor.addedBy,
      position: nextPosition,
    },
  })

  if (!isGroceryListType(list.type)) return { ok: true, item }

  const ingredient = item.ingredient_id
    ? await db.ingredient.findFirst({
        where: { id: item.ingredient_id, family_id: actor.familyId },
        select: { name: true, section: true },
      })
    : null
  const row = { content: item.content, ingredient }
  const [section] = sectionsFor([row], await loadSectionOverrides(db, actor.familyId, [row]))
  return { ok: true, item: { ...item, section } }
}
