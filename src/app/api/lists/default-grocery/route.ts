import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { canCreateList } from '@/lib/role-capabilities'
import { resolveDefaultGroceryList } from '@/lib/grocery-from-recipe'

export const dynamic = 'force-dynamic'

/**
 * POST /api/lists/default-grocery (ADR-0007 O-4, #253)
 *
 * Finds or creates the household's default grocery list with the same server
 * rule `from-recipe` uses (`resolveDefaultGroceryList`: newest `grocery` list,
 * else newest `shopping` list, else a new "Groceries" list, under a
 * per-household advisory lock). Used by the capture flow. Parent and teen,
 * like list creation. 200 `{ list: { id, name, type }, created }`.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    if (!canCreateList(auth.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { created, ...list } = await resolveDefaultGroceryList(prisma!, auth.user.family_id, auth.user.id)
    return NextResponse.json({ list, created })
  } catch (error) {
    console.error(
      'Error resolving the default grocery list:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
