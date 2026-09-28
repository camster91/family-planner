import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { parseDateOnly } from '@/lib/dates'
import {
  INVENTORY_ITEM_SELECT,
  InventoryInputError,
  canWriteInventory,
  cleanItemName,
  resolveInventoryIngredient,
  toInventoryDto,
  updateInventorySchema,
} from '@/lib/inventory'
import { inventoryError, inventoryJson, itemNotFound, readJson, todayFrom, writeForbidden } from '@/lib/inventory-http'

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
// same-household ingredient matches); `ingredient_id: null` unlinks.
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

    const json = await readJson(request)
    if (!json.ok) return json.response
    const parsed = updateInventorySchema.safeParse(json.body)
    if (!parsed.success) return inventoryError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message)
    const data = parsed.data
    const familyId = auth.user.family_id
    const { id } = await context.params

    const existing = await prisma!.inventoryItem.findFirst({
      where: { id, family_id: familyId },
      select: { id: true, name: true },
    })
    if (!existing) return itemNotFound()

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
    update.updated_at = new Date()

    // Scoped by family again, so a row moved or deleted in between is a 404.
    const result = await prisma!.inventoryItem.updateMany({ where: { id, family_id: familyId }, data: update })
    if (result.count === 0) return itemNotFound()
    const row = await prisma!.inventoryItem.findFirst({ where: { id, family_id: familyId }, select: INVENTORY_ITEM_SELECT })
    if (!row) return itemNotFound()
    return inventoryJson({ item: toInventoryDto(row, today) })
  } catch (err) {
    if (err instanceof InventoryInputError) return inventoryError(400, 'INGREDIENT_NOT_FOUND', err.message)
    console.error('Error updating inventory item:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

// DELETE /api/inventory/[id] — parent or teen ("used it" / "threw it out").
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    if (!canWriteInventory(auth.user.role)) return writeForbidden()

    const { id } = await context.params
    const result = await prisma!.inventoryItem.deleteMany({ where: { id, family_id: auth.user.family_id } })
    if (result.count === 0) return itemNotFound()
    return inventoryJson({ success: true })
  } catch (err) {
    console.error('Error deleting inventory item:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
