import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { undoAddSchema, undoRecipeAdd } from '@/lib/grocery-from-recipe'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * POST /api/lists/items/undo-add `{ requestId }` (ADR-0007 O-5, #253).
 *
 * Removes the still-unticked rows that one `from-recipe` request created, for
 * the person who made it, within 10 minutes. Every other delete stays
 * parent-only (`DELETE /api/lists/items/[id]`). 404 unknown or another
 * household's request; 403 another member's request or a shared device; 409
 * after the window. Safe to retry: a second undo removes 0 rows.
 */
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = undoAddSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const result = await undoRecipeAdd(prisma!, parsed.data.requestId, {
      id: auth.user.id,
      family_id: auth.user.family_id,
    })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    logRouteError('POST /api/lists/items/undo-add', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
