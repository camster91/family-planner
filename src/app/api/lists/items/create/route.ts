import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { listId, content, quantity, category, notes } = await request.json()

    if (!listId || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    try {
      // Verify user has access to the list
      const list = await (prisma as any).list.findUnique({
        where: { id: listId },
        select: { family_id: true }
      })

      if (!list) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 })
      }

      // Check if user is in the same family
      const user = await prisma!.user.findUnique({
        where: { id: userId },
        select: { family_id: true }
      })

      if (!user || user.family_id !== list.family_id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      // Get current max position
      const maxPositionItem = await (prisma as any).list_item.findFirst({
        where: { list_id: listId },
        orderBy: { position: 'desc' },
        select: { position: true }
      })

      const nextPosition = (maxPositionItem?.position || 0) + 1

      // Create the list item
      const item = await (prisma as any).list_item.create({
        data: {
          list_id: listId,
          content,
          quantity: quantity || 1,
          category: category || null,
          notes: notes || null,
          added_by: userId,
          position: nextPosition,
          updated_at: new Date(),
        }
      })

      // Update list's updated_at timestamp
      await (prisma as any).list.update({
        where: { id: listId },
        data: { updated_at: new Date() }
      })

      return NextResponse.json({ success: true, item })
    } catch (error) {
      console.error('Error creating list item:', error)
      return NextResponse.json({ error: 'Failed to create list item' }, { status: 500 })
    }

  } catch (error) {
    console.error('Error creating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
