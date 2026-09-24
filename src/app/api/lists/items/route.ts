import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET /api/lists/items?listId=<id>
// Returns the items of one list (family-scoped). The list index endpoint only
// includes counts, so this is the read side of the items CRUD.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const listId = request.nextUrl.searchParams.get('listId')
    if (!listId) {
      return NextResponse.json({ error: 'listId is required' }, { status: 400 })
    }

    const list = await prisma!.list.findUnique({
      where: { id: listId },
      select: { family_id: true },
    })
    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    const items = await prisma!.listItem.findMany({
      where: { list_id: listId },
      orderBy: [{ checked: 'asc' }, { position: 'asc' }, { created_at: 'asc' }],
    })

    return NextResponse.json({ items })
  } catch (error) {
    console.error('Error fetching list items:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}