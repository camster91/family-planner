/**
 * Deleting one list item: the single write behind the REST
 * `DELETE /api/lists/items/[id]` and the older `DELETE /api/lists/items/delete?itemId=`
 * that installed Android builds still call (route inventory F-6, #289).
 *
 * The item is matched together with its list's household, so another
 * household's item and a missing one are the same "not found" and nothing is
 * deleted. Role and feature gates stay in the route handlers.
 */
import type { PrismaClient } from '@prisma/client'

type Db = Pick<PrismaClient, 'listItem'>

/**
 * True when the item existed in `familyId` and is now gone. The lookup is
 * household-scoped, so a foreign id never reaches a write; the delete is by id
 * (`deleteMany`, so a row removed in between is a plain "not found", not an
 * error).
 */
export async function deleteHouseholdListItem(db: Db, itemId: string, familyId: string): Promise<boolean> {
  const item = await db.listItem.findFirst({
    where: { id: itemId, list: { family_id: familyId } },
    select: { id: true },
  })
  if (!item) return false
  const result = await db.listItem.deleteMany({ where: { id: item.id } })
  return result.count > 0
}
