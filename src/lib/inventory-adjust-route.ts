/**
 * Shared handler of `POST /api/inventory/[id]/consume` and
 * `POST /api/inventory/[id]/discard` (#158/#121). Order of checks, like the
 * other inventory writes: paired device refused → person auth → feature gate
 * → parent or teen → `today` → Idempotency-Key format → body → idempotent
 * effect (household-scoped item lookup, compare-and-set, one adjustment row).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import {
  INVENTORY_CONSUME_ACTION,
  INVENTORY_DISCARD_ACTION,
  canWriteInventory,
  consumeInventorySchema,
  discardInventorySchema,
  toInventoryDto,
} from '@/lib/inventory'
import { adjustInventoryItem, toAdjustmentDto, type AdjustmentKind } from '@/lib/inventory-adjust'
import {
  effectError,
  finishedResult,
  inventoryError,
  notFoundResult,
  readOptionalJson,
  todayFrom,
  writeForbidden,
} from '@/lib/inventory-http'

export type ItemContext = { params: Promise<{ id: string }> }

export async function handleAdjust(request: NextRequest, context: ItemContext, kind: AdjustmentKind): Promise<NextResponse> {
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

    const json = await readOptionalJson(request)
    if (!json.ok) return json.response
    const parsed =
      kind === 'consume' ? consumeInventorySchema.safeParse(json.body) : discardInventorySchema.safeParse(json.body)
    if (!parsed.success) return inventoryError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message)
    const amount = kind === 'consume' ? ((parsed.data as { amount?: number | null }).amount ?? null) : null

    const familyId = auth.user.family_id
    const { id } = await context.params
    const res = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId,
        userId: auth.user.id,
        action: kind === 'consume' ? INVENTORY_CONSUME_ACTION : INVENTORY_DISCARD_ACTION,
      },
      { id, amount },
      async ({ recordId }) => {
        const result = await adjustInventoryItem(prisma!, {
          familyId,
          itemId: id,
          actorId: auth.user.id,
          kind,
          amount,
          requestId: recordId,
        })
        if (!result.ok) {
          switch (result.reason) {
            case 'NOT_FOUND':
              return notFoundResult()
            case 'FINISHED':
              return finishedResult()
            case 'NO_AMOUNT':
              return effectError(
                400,
                'VALIDATION_ERROR',
                'This item has no amount. Use all of it, or set an amount first.'
              )
            default:
              return effectError(409, 'INVENTORY_CONFLICT', 'The item changed while saving. Try again.')
          }
        }
        return {
          status: 200,
          body: { item: toInventoryDto(result.item, today), adjustment: toAdjustmentDto(result.adjustment) },
        }
      }
    )
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  } catch (err) {
    console.error(`Error recording inventory ${kind}:`, err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
