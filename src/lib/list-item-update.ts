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
 *
 * ADR-0007 (#251): optional `amount`, `unit` and `ingredient_id` (null clears).
 * An `ingredient_id` must belong to the item's household (a foreign or missing
 * id is the same 400). Unticking a recipe-added row whose (list, ingredient,
 * source) already has another open row violates the partial unique index
 * `ListItem_open_recipe_source_key`; that `P2002` is answered as 409
 * `DUPLICATE_OPEN_ITEM`, which the #247 offline queue treats as a conflict.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { PersonListItemAuthorityRefusal } from './person-list-item-authority'
import { recordSectionTick } from '@/lib/grocery-section-store'
import { logRouteError } from '@/lib/api-error'

export interface ListItemUpdate {
  itemId: string
  /** Server version precondition; optional for installed legacy clients. */
  expectedUpdatedAt?: string
  checked?: boolean
  content?: string
  quantity?: number
  category?: string
  notes?: string
  amount?: number | null
  unit?: string | null
  ingredient_id?: string | null
}

export const DUPLICATE_OPEN_ITEM = 'DUPLICATE_OPEN_ITEM'
export const LIST_ITEM_CHANGED = 'LIST_ITEM_CHANGED'

export type ListItemUpdateResult =
  | { status: 200; body: { success: true; item: Record<string, unknown> } }
  | { status: 409; body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS'; message: string; retryable: true } } }
  | { status: 400 | 401 | 403 | 404; body: { error: string } }
  | { status: 409; body: { error: { code: typeof DUPLICATE_OPEN_ITEM | typeof LIST_ITEM_CHANGED; message: string; retryable: false } } }

/** Supplied only by personal routes; device auth stays in the device write coordinator. */
export type ListItemUpdateOptions = {
  receipt?: { recordId: string | null; action: 'list-item.update' | 'list-item.edit' }
  authorize?: (tx: Prisma.TransactionClient) => Promise<PersonListItemAuthorityRefusal | null>
}

type Db = Pick<PrismaClient, '$transaction'>

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

export async function updateListItem(
  db: Db,
  data: ListItemUpdate,
  user: { id: string; family_id: string },
  now: () => Date = () => new Date(),
  options: ListItemUpdateOptions = {}
): Promise<ListItemUpdateResult> {
  try {
    return await applyListItemUpdate(db, data, user, now, options)
  } catch (error) {
    // ListItem's only unique constraint besides its id is the partial index
    // "ListItem_open_recipe_source_key" (MEALS_AND_GROCERIES.md §5).
    if (isUniqueViolation(error)) {
      return {
        status: 409,
        body: {
          error: {
            code: DUPLICATE_OPEN_ITEM,
            message: 'This item is already on the list and not yet ticked.',
            retryable: false,
          },
        },
      }
    }
    throw error
  }
}

function receiptUnavailable(): ListItemUpdateResult {
  return { status: 409, body: { error: {
    code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Keep this change and retry recovery.', retryable: true,
  } } }
}

async function applyListItemUpdate(
  db: Db,
  data: ListItemUpdate,
  user: { id: string; family_id: string },
  now: () => Date,
  options: ListItemUpdateOptions
): Promise<ListItemUpdateResult> {
  const { itemId, checked, content, quantity, category, notes, amount, unit, ingredient_id } = data
  return db.$transaction(async (tx) => {
    if (options.authorize) {
      const denied = await options.authorize(tx)
      if (denied) return denied
    }
    // Personal receipt ownership comes from the server coordinator, never request JSON.
    // Lock before the item so takeover recovers a committed result before comparing versions.
    const receipt = options.receipt
    if (receipt?.recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord"
        WHERE "id"=${receipt.recordId} AND "family_id"=${user.family_id}
          AND "user_id"=${user.id} AND "scope"=${`user:${user.id}`}
          AND "action"=${receipt.action} FOR UPDATE`
      const record = await tx.idempotencyRecord.findFirst({
        where: { id: receipt.recordId, family_id: user.family_id, user_id: user.id,
          scope: `user:${user.id}`, action: receipt.action },
        select: { response_status: true, response_body: true },
      })
      if (!record) return receiptUnavailable()
      if (record.response_status !== null) {
        const body = record.response_body
        // Only this writer's successful shape is replayable here. Unknown completed
        // receipts hold for recovery; they must never cause a second mutation.
        if (record.response_status === 200 && body && typeof body === 'object' && !Array.isArray(body)
          && body.success === true && body.item && typeof body.item === 'object'
          && !Array.isArray(body.item) && body.item.id === itemId) {
          return { status: 200, body: body as { success: true; item: Record<string, unknown> } }
        }
        return receiptUnavailable()
      }
    }
    // Serialize only an owned item; a foreign target must not acquire another household's row lock.
    // Existing missing/foreign statuses are decided below without returning its content.
    await tx.$queryRaw`SELECT i."id" FROM "ListItem" i JOIN "List" l ON l."id"=i."list_id"
      WHERE i."id"=${itemId} AND l."family_id"=${user.family_id} FOR UPDATE OF i`
    const item = await tx.listItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { family_id: true } } },
    })
    if (!item) return { status: 404, body: { error: 'Item not found' } }
    if (item.list.family_id !== user.family_id) return { status: 403, body: { error: 'Forbidden' } }
    // Check after ownership, under the same row lock as the write. A conflict
    // never exposes another household's current values or version.
    if (data.expectedUpdatedAt !== undefined && new Date(data.expectedUpdatedAt).getTime() !== item.updated_at.getTime()) {
      return { status: 409, body: { error: { code: LIST_ITEM_CHANGED, message: 'This item changed. Refresh the list and review it before saving.', retryable: false } } }
    }


    if (ingredient_id) {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: ingredient_id, family_id: user.family_id },
        select: { id: true },
      })
      if (!ingredient) return { status: 400, body: { error: 'Ingredient not found' } }
    }

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
    if (amount !== undefined) updateData.amount = amount
    if (unit !== undefined) updateData.unit = unit
    if (ingredient_id !== undefined) updateData.ingredient_id = ingredient_id

    if (Object.keys(updateData).length > 0) {
      // Server-owned ordering remains unique within a millisecond or if the
      // wall clock retreats. A no-op tick keeps its original version.
      updateData.updated_at = new Date(Math.max(now().getTime(), item.updated_at.getTime() + 1))
    }
    const { list: _list, ...unchanged } = item
    const updated =
      Object.keys(updateData).length === 0
        ? unchanged
        : await tx.listItem.update({ where: { id: itemId }, data: updateData })
    const body = { success: true as const, item: updated }
    if (receipt?.recordId) {
      // Failure rolls back the item as well. Keep exact HTTP JSON, including date strings.
      await tx.idempotencyRecord.update({ where: { id: receipt.recordId }, data: {
        response_status: 200,
        response_body: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonObject,
      } })
    }
    return { status: 200, body }
  })
}

/**
 * `updateListItem` plus the grocery walking order (#273): when this request is
 * the one that ticked the row (open → ticked by `user` now, not a no-op that
 * kept an older tick), the row's store section is appended to the list's
 * current shopping trip. Best effort: a failure is logged without content and
 * never fails the tick. Shared by PATCH /api/lists/items/update (person) and
 * PATCH /api/device/lists/items/:id (paired tablet, #274, where `user` is the
 * member picked with "Who's this?"). Callers run it inside their idempotency
 * effect, so a replayed request records nothing again.
 */
export async function updateListItemAndNoteTick(
  db: PrismaClient,
  data: ListItemUpdate,
  user: { id: string; family_id: string },
  options: ListItemUpdateOptions = {}
): Promise<ListItemUpdateResult> {
  const startedAt = new Date()
  const result = await updateListItem(db, data, user, undefined, options)
  if (result.status === 200 && data.checked === true) {
    const item = result.body.item
    const checkedAt = item.checked_at instanceof Date ? item.checked_at : null
    if (item.checked === true && item.checked_by === user.id && checkedAt && checkedAt >= startedAt) {
      try {
        await recordSectionTick(db, { familyId: user.family_id, itemId: data.itemId, at: checkedAt })
      } catch (err) {
        logRouteError('list-item-update.section-tick', err, undefined)
      }
    }
  }
  return result
}
