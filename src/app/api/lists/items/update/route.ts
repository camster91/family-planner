import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { itemId, checked, content, quantity, category, notes } = await request.json()

    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }

    try {
      // Get the item to verify access
      const item = await (prisma as any).list_item.findUnique({
        where: { id: itemId },
        include: { list: { select: { family_id: true } } }
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Check if user is in the same family
      const user = await prisma!.user.findUnique({
        where: { id: userId },
        select: { family_id: true }
      })

      if (!user || user.family_id !== item.list.family_id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      // Build update object
      const updateData: any = {
        updated_at: new Date(),
      }

      if (typeof checked === 'boolean') {
        updateData.checked = checked
        if (checked) {
          updateData.checked_by = userId
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

      // Update the list item
      const updatedItem = await (prisma as any).list_item.update({
        where: { id: itemId },
        data: updateData
      })

      // Update list's updated_at timestamp
      await (prisma as any).list.update({
        where: { id: item.list_id },
        data: { updated_at: new Date() }
      })

      return NextResponse.json({ success: true, item: updatedItem })
    } catch (error) {
      console.error('Error updating list item:', error)
      return NextResponse.json({ error: 'Failed to update list item' }, { status: 500 })
    }

  } catch (error) {
    console.error('Error updating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
