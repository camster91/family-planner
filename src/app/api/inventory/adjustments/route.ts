import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { ADJUSTMENT_SELECT, isUndoable, toAdjustmentDto } from '@/lib/inventory-adjust'
import { inventoryError, inventoryJson } from '@/lib/inventory-http'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const ADJUSTMENTS_DEFAULT_LIMIT = 20
const ADJUSTMENTS_MAX_LIMIT = 100

/**
 * GET /api/inventory/adjustments?itemId=&limit=&offset= (#158/#121). The
 * household's "Used it" / "Throw away" history, newest first, each with the
 * item's name and current status and `undoable` (the latest change to its
 * item, not undone, and the item still at the version that change set), so
 * the page offers Undo after the toast is gone only where it will work. `limit` 1–100 (default 20). Every role may read (the items are
 * readable by every member).
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')
    if (itemId !== null && (itemId.length === 0 || itemId.length > 128)) {
      return inventoryError(400, 'VALIDATION_ERROR', 'itemId is not valid')
    }
    const limitRaw = searchParams.get('limit')
    const offsetRaw = searchParams.get('offset')
    const limit = limitRaw === null ? ADJUSTMENTS_DEFAULT_LIMIT : Number(limitRaw)
    const offset = offsetRaw === null ? 0 : Number(offsetRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > ADJUSTMENTS_MAX_LIMIT || !Number.isInteger(offset) || offset < 0) {
      return inventoryError(400, 'VALIDATION_ERROR', `limit must be 1-${ADJUSTMENTS_MAX_LIMIT} and offset >= 0`)
    }

    const rows = await prisma!.inventoryAdjustment.findMany({
      where: { family_id: auth.user.family_id, ...(itemId ? { item_id: itemId } : {}) },
      select: { ...ADJUSTMENT_SELECT, item: { select: { name: true, status: true, updated_at: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const adjustments = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...toAdjustmentDto(r),
      item_name: r.item?.name ?? '',
      item_status: r.item?.status ?? 'active',
      undoable: isUndoable(r, r.item),
    }))
    return inventoryJson({ adjustments, nextOffset: hasMore ? offset + limit : null })
  } catch (err) {
    logRouteError('GET /api/inventory/adjustments', err, getRequestId(request))
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
