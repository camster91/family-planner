import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { updateListItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = updateListItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { itemId, checked, content, quantity, category, notes } = parsed.data

    // Get the item and verify family access
    const item = await prisma!.listItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { family_id: true } } },
    })

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(item.list.family_id, auth.user.family_id)
    if (familyError) return familyError

    const updateData: Record<string, unknown> = {}

    if (typeof checked === 'boolean') {
      updateData.checked = checked
      if (checked) {
        updateData.checked_by = auth.user.id
        updateData.checked_at = new Date()
      } else {
        updateData.checked_by = null
        updateData.checked_at = null
      }
    }

    if (content !== undefined) updateData.content = content
    if (quantity !== undefined) updateData.quantity = quantity
    if (category !== undefined) updateData.category = category
    if (notes !== undefined) updateData.notes = notes

    const updatedItem = await prisma!.listItem.update({
      where: { id: itemId },
      data: updateData,
    })

    return NextResponse.json({ success: true, item: updatedItem })
  } catch (error) {
    console.error('Error updating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
