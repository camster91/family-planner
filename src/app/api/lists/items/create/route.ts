import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createListItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createListItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { listId, content, quantity, category, notes } = parsed.data

    // Verify list belongs to user's family
    const list = await prisma!.list.findUnique({
      where: { id: listId },
      select: { family_id: true },
    })

    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Get current max position
    const maxPositionItem = await prisma!.listItem.findFirst({
      where: { list_id: listId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const nextPosition = (maxPositionItem?.position || 0) + 1

    const item = await prisma!.listItem.create({
      data: {
        list_id: listId,
        content,
        quantity: quantity || 1,
        category: category || null,
        notes: notes || null,
        added_by: auth.user.id,
        position: nextPosition,
      },
    })

    return NextResponse.json({ success: true, item })
  } catch (error) {
    console.error('Error creating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
