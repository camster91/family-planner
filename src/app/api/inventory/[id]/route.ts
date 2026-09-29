import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { parseDateOnly } from '@/lib/dates'
import {
  INVENTORY_DELETE_ACTION,
  INVENTORY_ITEM_SELECT,
  INVENTORY_UPDATE_ACTION,
  InventoryInputError,
  canWriteInventory,
  cleanItemName,
  resolveInventoryIngredient,
  toInventoryDto,
  updateInventorySchema,
} from '@/lib/inventory'
import {
  effectError,
  finishedResult,
  inventoryError,
  inventoryJson,
  itemNotFound,
  notFoundResult,
  readJson,
  todayFrom,
  writeForbidden,
} from '@/lib/inventory-http'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { nextItemVersion } from '@/lib/inventory-adjust'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

// Every lookup is scoped by family_id, so another household's item answers
// exactly like a missing one (same 404 body).

// GET /api/inventory/[id]?today= — any role.
export async function GET(request: NextRequest, context: Context) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    const today = todayFrom(new URL(request.url).searchParams)
    if (today instanceof NextResponse) return today

    const { id } = await context.params
    const row = await prisma!.inventoryItem.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: INVENTORY_ITEM_SELECT,
    })
    if (!row) return itemNotFound()
    return inventoryJson({ item: toInventoryDto(row, today) })
  } catch (err) {
    console.error('Error fetching inventory item:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

// PATCH /api/inventory/[id]?today= — parent or teen. Changing `name` without
// sending `ingredient_id` re-links the item by name (or unlinks it when no
// same-household ingredient matches); `ingredient_id: null` unlinks. Moving
// is `location`. A consumed or discarded item is 409 INVENTORY_ITEM_FINISHED
// (Undo puts it back first).
//
// Optional `Idempotency-Key` (#158): the same key and body replays the stored
// 200; a different item or body with the same key is 422. The update sets
// explicit values, so a re-run after a crash converges.
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    if (!canWriteInventory(auth.user.role)) return writeForbidden()

    const today = todayFrom(new URL(request.url).searchParams)
    if (today instanceof NextResponse) return today

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const json = await readJson(request)
    if (!json.ok) return json.response
    const parsed = updateInventorySchema.safeParse(json.body)
    if (!parsed.success) return inventoryError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message)
    const data = parsed.data
    const familyId = auth.user.family_id
    const { id } = await context.params

    const res = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId, userId: auth.user.id, action: INVENTORY_UPDATE_ACTION },
      { id, ...data },
      async () => {
        const existing = await prisma!.inventoryItem.findFirst({
          where: { id, family_id: familyId },
          select: { id: true, name: true, status: true, updated_at: true },
        })
        if (!existing) return notFoundResult()
        if (existing.status !== 'active') return finishedResult()

        const update: Record<string, unknown> = {}
        const name = data.name !== undefined ? cleanItemName(data.name) : undefined
        if (name !== undefined) update.name = name
        if (data.ingredient_id !== undefined || (name !== undefined && name !== existing.name)) {
          update.ingredient_id = await resolveInventoryIngredient(prisma!, familyId, name ?? existing.name, data.ingredient_id)
        }
        if (data.amount !== undefined) update.amount = data.amount
        if (data.unit !== undefined) update.unit = data.unit
        if (data.location !== undefined) update.location = data.location
        if (data.expires_on !== undefined) update.expires_on = data.expires_on ? parseDateOnly(data.expires_on) : null
        if (data.date_kind !== undefined) update.date_kind = data.date_kind
        if (data.category !== undefined) update.category = data.category
        if (data.purchased_on !== undefined) update.purchased_on = data.purchased_on ? parseDateOnly(data.purchased_on) : null
        if (data.opened_on !== undefined) update.opened_on = data.opened_on ? parseDateOnly(data.opened_on) : null
        // Always later than the previous version (Undo's compare-and-set, #158).
        update.updated_at = nextItemVersion(existing.updated_at)

        // Compare-and-set on the version read above, scoped by family and
        // status again: a row finished, deleted or changed in between is a
        // 409 / 404 / retryable 409, never a silent overwrite.
        const result = await prisma!.inventoryItem.updateMany({
          where: { id, family_id: familyId, status: 'active', updated_at: existing.updated_at },
          data: update,
        })
        if (result.count === 0) {
          const still = await prisma!.inventoryItem.findFirst({ where: { id, family_id: familyId }, select: { status: true } })
          if (!still) return notFoundResult()
          return still.status !== 'active'
            ? finishedResult()
            : effectError(409, 'INVENTORY_CONFLICT', 'The item changed while saving. Try again.')
        }
        const row = await prisma!.inventoryItem.findFirst({ where: { id, family_id: familyId }, select: INVENTORY_ITEM_SELECT })
        if (!row) return notFoundResult()
        return { status: 200, body: { item: toInventoryDto(row, today) } }
      }
    )
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  } catch (err) {
    if (err instanceof InventoryInputError) return inventoryError(400, 'INGREDIENT_NOT_FOUND', err.message)
    console.error('Error updating inventory item:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

// DELETE /api/inventory/[id] — parent or teen. Removes the item and its
// history (for an item added by mistake); "Used it" and "Throw away" are the
// consume/discard routes, which keep history and can be undone.
// Optional `Idempotency-Key` (#158): a retry after a lost response replays the
// stored 200 instead of answering 404.
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    if (!canWriteInventory(auth.user.role)) return writeForbidden()

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const familyId = auth.user.family_id
    const { id } = await context.params
    const res = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId, userId: auth.user.id, action: INVENTORY_DELETE_ACTION },
      { id },
      async () => {
        const result = await prisma!.inventoryItem.deleteMany({ where: { id, family_id: familyId } })
        if (result.count === 0) return notFoundResult()
        return { status: 200, body: { success: true } }
      }
    )
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  } catch (err) {
    console.error('Error deleting inventory item:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
