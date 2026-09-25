import type { PrismaClient } from '@prisma/client'

/** List types whose unchecked items count as "things to buy" on the dashboard. */
export const SHOPPING_LIST_TYPES = ['grocery', 'shopping'] as const

export interface ShoppingSnapshotItem {
  id: string
  content: string
  quantity: number
  listId: string
  listName: string
}

export interface ShoppingSnapshot {
  /** Oldest open items first, capped at `limit`. */
  items: ShoppingSnapshotItem[]
  /** Total open items across the family's grocery/shopping lists. */
  total: number
}

type ListItemDelegate = Pick<PrismaClient['listItem'], 'findMany' | 'count'>

/**
 * Open (unchecked) items on a family's grocery/shopping lists, for the
 * dashboard's Shopping card. Always scoped by `familyId` through the owning list.
 */
export async function getOpenShoppingItems(
  db: { listItem: ListItemDelegate },
  familyId: string,
  limit = 5
): Promise<ShoppingSnapshot> {
  const where = {
    checked: false,
    list: { family_id: familyId, type: { in: [...SHOPPING_LIST_TYPES] } },
  }
  const [rows, total] = await Promise.all([
    db.listItem.findMany({
      where,
      select: {
        id: true,
        content: true,
        quantity: true,
        list: { select: { id: true, name: true } },
      },
      // Explicit total order so the card does not reshuffle between loads.
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: limit,
    }),
    db.listItem.count({ where }),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id,
      content: r.content,
      quantity: r.quantity,
      listId: r.list.id,
      listName: r.list.name,
    })),
    total,
  }
}
