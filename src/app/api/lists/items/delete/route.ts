import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')

    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }

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

    await prisma!.listItem.delete({
      where: { id: itemId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
