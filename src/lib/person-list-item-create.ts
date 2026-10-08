/**
 * Person-session create effect for #135. The item and completed keyed response
 * commit together, so a lost response or a lock takeover cannot duplicate the
 * add or resurrect an item that someone has since deleted. No-key callers keep
 * making distinct deliberate adds. The route authenticates and checks ownership
 * before reading a stored response; this effect checks it again under a lock.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createListItem, type NewListItem } from '@/lib/list-item-create'
import type { EffectResult } from '@/lib/idempotency'

export async function createPersonListItem(
  db: Pick<PrismaClient, '$transaction'>,
  input: NewListItem,
  actor: { familyId: string; addedBy: string },
  recordId: string | null
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    if (recordId) {
      // A takeover can overlap a slow original effect. Serialise them on the
      // stable record, then recheck completion inside this transaction.
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`
      const record = await tx.idempotencyRecord.findFirst({
        where: { id: recordId, family_id: actor.familyId, user_id: actor.addedBy },
        select: { response_status: true, response_body: true },
      })
      if (!record) {
        return {
          status: 409,
          body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Please retry this add.', retryable: true } },
        }
      }
      if (record.response_status != null) return { status: record.response_status, body: record.response_body }
    }

    // Also serialise placement and list deletion. A deleted/foreign list is
    // never recreated; section lookup failures roll the entire add back.
    await tx.$queryRaw`SELECT "id" FROM "List" WHERE "id" = ${input.listId} AND "family_id" = ${actor.familyId} FOR UPDATE`
    const result = await createListItem(tx, input, actor, { sourceRequestId: recordId })
    if (!result.ok) {
      return result.reason === 'ingredient_not_found'
        ? { status: 400, body: { error: 'Ingredient not found' } }
        : { status: 404, body: { error: 'List not found' } }
    }
    // Normalise Dates exactly as the HTTP JSON response does before storing it.
    const body = JSON.parse(JSON.stringify({ success: true, item: result.item })) as Prisma.InputJsonObject
    if (recordId) {
      await tx.idempotencyRecord.update({ where: { id: recordId }, data: { response_status: 200, response_body: body } })
    }
    return { status: 200, body }
  })
}
