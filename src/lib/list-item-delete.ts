/**
 * Deleting one list item: the single write behind the REST
 * `DELETE /api/lists/items/[id]` and the older `DELETE /api/lists/items/delete?itemId=`
 * that installed Android builds still call (route inventory F-6, #289).
 *
 * The item is matched together with its list's household, so another
 * household's item and a missing one are the same "not found" and nothing is
 * deleted. Personal routes additionally renew role/session/feature authority in
 * the same transaction before using this primitive.
 */
import type { PrismaClient } from '@prisma/client'
import { authorizePersonListItemInTx, type PersonListItemActor } from './person-list-item-authority'
import type { EffectResult } from './idempotency'

type Db = Pick<PrismaClient, 'listItem'>

/**
 * True when the item existed in `familyId` and is now gone. Both lookup and delete are
 * household-scoped, so a foreign id never reaches a write; the delete is by id and household
 * (`deleteMany`, so a row removed in between is a plain "not found", not an
 * error).
 */
export async function deleteHouseholdListItem(db: Db, itemId: string, familyId: string): Promise<boolean> {
  const item = await db.listItem.findFirst({
    where: { id: itemId, list: { family_id: familyId } },
    select: { id: true },
  })
  if (!item) return false
  const result = await db.listItem.deleteMany({ where: { id: item.id, list: { family_id: familyId } } })
  return result.count > 0
}

/** Live-only destructive action; no offline queue, keyed replay or new delete policy. */
export function deletePersonListItem(
  db: Pick<PrismaClient, '$transaction'>,
  itemId: string,
  actor: PersonListItemActor,
): Promise<EffectResult> {
  return db.$transaction(async tx => {
    const denied = await authorizePersonListItemInTx(tx, actor, {})
    if (denied) return denied
    if (actor.role !== 'parent')
      return { status: 403, body: { error: 'Only parents can perform this action' } }
    await tx.$queryRaw`SELECT i."id" FROM "ListItem" i JOIN "List" l ON l."id"=i."list_id"
      WHERE i."id"=${itemId} AND l."family_id"=${actor.familyId} FOR UPDATE OF i`
    const deleted = await deleteHouseholdListItem(tx, itemId, actor.familyId)
    return deleted
      ? { status: 200, body: { success: true } }
      : { status: 404, body: { error: 'Item not found' } }
  })
}
