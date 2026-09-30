import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { isGroceryListType } from '@/lib/grocery-display'
import {
  SECTION_INGREDIENT_SELECT,
  loadSectionOrder,
  loadSectionOverrides,
  sectionsFor,
} from '@/lib/grocery-section-store'
import { DEPRECATED_SINCE_289, markDeprecated } from '@/lib/deprecation'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// GET /api/lists/items?listId=<id>
// Returns the items of one list (family-scoped). The list index endpoint only
// includes counts, so this is the read side of the items CRUD.
//
// Deprecated (route inventory F-5, #289): no in-app caller (the list page
// reads on the server), only e2e/. Kept, unchanged, until the ADR-0004 review
// of installed Android clients; every response adds a `Deprecation` header.
export async function GET(request: NextRequest) {
  return markDeprecated(await readListItems(request), { since: DEPRECATED_SINCE_289 })
}

async function readListItems(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const listId = request.nextUrl.searchParams.get('listId')
    if (!listId) {
      return NextResponse.json({ error: 'listId is required' }, { status: 400 })
    }

    const list = await prisma!.list.findUnique({
      where: { id: listId },
      select: { family_id: true, type: true, sort_by_section: true },
    })
    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    const orderBy = [{ checked: 'asc' as const }, { position: 'asc' as const }, { created_at: 'asc' as const }]
    if (!isGroceryListType(list.type)) {
      const items = await prisma!.listItem.findMany({ where: { list_id: listId }, orderBy })
      return NextResponse.json({ items })
    }

    // Grocery/shopping lists (#273): every row carries its resolved store
    // `section`, and the response says whether and in which order to group.
    const rows = await prisma!.listItem.findMany({
      where: { list_id: listId },
      orderBy,
      include: { ingredient: SECTION_INGREDIENT_SELECT },
    })
    const sections = sectionsFor(rows, await loadSectionOverrides(prisma!, auth.user.family_id, rows))
    const items = rows.map(({ ingredient: _ingredient, ...row }, i) => ({ ...row, section: sections[i] }))
    const order = await loadSectionOrder(prisma!, auth.user.family_id)
    return NextResponse.json({
      items,
      sectionSort: { enabled: list.sort_by_section !== false, order: order.order, learned: order.learned },
    })
  } catch (error) {
    logRouteError('GET /api/lists/items', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}