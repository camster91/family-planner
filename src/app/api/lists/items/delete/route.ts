import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')

    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }

    try {
      // Get the item to verify access and get list_id
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

      // Delete the list item
      await (prisma as any).list_item.delete({
        where: { id: itemId }
      })

      // Update list's updated_at timestamp
      await (prisma as any).list.update({
        where: { id: item.list_id },
        data: { updated_at: new Date() }
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('Error deleting list item:', error)
      return NextResponse.json({ error: 'Failed to delete list item' }, { status: 500 })
    }

  } catch (error) {
    console.error('Error deleting list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
