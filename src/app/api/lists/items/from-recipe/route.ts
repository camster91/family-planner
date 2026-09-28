import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { idempotencyError, readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { ADD_FROM_RECIPE_ACTION, addFromRecipeSchema, addRecipeToGroceries } from '@/lib/grocery-from-recipe'

export const dynamic = 'force-dynamic'

const FAMILY_ROLES = new Set(['parent', 'teen', 'child'])

/**
 * POST /api/lists/items/from-recipe (ADR-0007 child D, #253;
 * MEALS_AND_GROCERIES.md §7).
 *
 * Adds a recipe's ingredients (all, or `ingredientIds`) to a grocery list,
 * once. `Idempotency-Key` is required: a retry or double tap replays the
 * stored 201; two different keys for the same meal still leave one open row
 * per ingredient (partial unique index). Parent, teen and child; a paired
 * shared device is refused (403) until #157 device writes exist. Needs both
 * the `meals` and `lists` features. Not offline-queueable (O-10).
 */
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    if (!FAMILY_ROLES.has(auth.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const mealsGate = await featureGate(auth.user.family_id, 'meals')
    if (mealsGate) return mealsGate
    const listsGate = await featureGate(auth.user.family_id, 'lists')
    if (listsGate) return listsGate

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError
    if (!key) return idempotencyError('IDEMPOTENCY_KEY_REQUIRED')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = addFromRecipeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const actor = { id: auth.user.id, family_id: auth.user.family_id }
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: ADD_FROM_RECIPE_ACTION,
      },
      parsed.data,
      // With a key, withIdempotency always holds a record, so recordId is set.
      ({ recordId }) => addRecipeToGroceries(prisma!, parsed.data, actor, recordId!)
    )
  } catch (error) {
    console.error('Error adding recipe ingredients:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
