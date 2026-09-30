import { NextRequest } from 'next/server'
import { handleAdjust, type ItemContext } from '@/lib/inventory-adjust-route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/[id]/discard?today= (#158/#121) — "Throw away" the whole
 * item. Empty body (or `{}`). Parent or teen; paired device refused. Optional
 * `Idempotency-Key`. 200 `{ item, adjustment }`.
 */
export async function POST(request: NextRequest, context: ItemContext) {
  return handleAdjust(request, context, 'discard')
}
