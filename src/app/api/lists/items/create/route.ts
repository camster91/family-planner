import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createListItemSchema } from '@/lib/validations'
import { createListItem } from '@/lib/list-item-create'

export const dynamic = 'force-dynamic'

/**
 * POST /api/lists/items/create. The write is `createListItem`
 * (src/lib/list-item-create.ts), shared with the paired tablet's quick add
 * (POST /api/device/lists/:id/items, #274).
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createListItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // Verify list belongs to user's family (a foreign list keeps its 403).
    const list = await prisma!.list.findUnique({
      where: { id: parsed.data.listId },
      select: { family_id: true },
    })
    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }
    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    const result = await createListItem(prisma!, parsed.data, {
      familyId: auth.user.family_id,
      addedBy: auth.user.id,
    })
    if (!result.ok) {
      return result.reason === 'ingredient_not_found'
        ? NextResponse.json({ error: 'Ingredient not found' }, { status: 400 })
        : NextResponse.json({ error: 'List not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, item: result.item })
  } catch (error) {
    console.error('Error creating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
