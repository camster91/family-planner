import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { deleteListSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (type) {
      where.type = type
    }

    const lists = await prisma!.list.findMany({
      where,
      include: {
        _count: { select: { items: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
    })

    return NextResponse.json({ lists })
  } catch (error) {
    console.error('Error fetching lists:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a list (family-scoped, cascade deletes items)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = deleteListSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'listId is required' }, { status: 400 })
    }

    const list = await (prisma as any).list.findUnique({
      where: { id: parsed.data.listId },
      select: { family_id: true },
    })

    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    await (prisma as any).list.delete({ where: { id: parsed.data.listId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
