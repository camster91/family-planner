import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { INVENTORY_UNDO_ACTION, canWriteInventory, toInventoryDto } from '@/lib/inventory'
import { toAdjustmentDto, undoInventoryAdjustment } from '@/lib/inventory-adjust'
import { effectError, inventoryError, todayFrom, writeForbidden } from '@/lib/inventory-http'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * POST /api/inventory/adjustments/[id]/undo?today= (#158/#121). Puts the item
 * back as it was before one "Used it" / "Throw away": status and amount
 * restored, the adjustment marked undone (kept as history). Only while nothing
 * else changed the item since, otherwise 409 `INVENTORY_UNDO_CONFLICT`.
 * Undoing an already undone change returns the item (200, `alreadyUndone`).
 * Parent or teen; paired device refused. Optional `Idempotency-Key`.
 */
export async function POST(request: NextRequest, context: Context) {
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

    const familyId = auth.user.family_id
    const { id } = await context.params
    const res = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId, userId: auth.user.id, action: INVENTORY_UNDO_ACTION },
      { id },
      async () => {
        const result = await undoInventoryAdjustment(prisma!, { familyId, adjustmentId: id, actorId: auth.user.id })
        if (!result.ok) {
          return result.reason === 'NOT_FOUND'
            ? effectError(404, 'INVENTORY_ADJUSTMENT_NOT_FOUND', 'That change was not found')
            : effectError(
                409,
                'INVENTORY_UNDO_CONFLICT',
                'This item changed after that, so it cannot be undone. Edit the item instead.'
              )
        }
        return {
          status: 200,
          body: {
            item: toInventoryDto(result.item, today),
            adjustment: toAdjustmentDto(result.adjustment),
            alreadyUndone: result.alreadyUndone,
          },
        }
      }
    )
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  } catch (err) {
    console.error('Error undoing inventory change:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
