import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { deleteChoreSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - List chores for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const assigned_to = searchParams.get('assigned_to')

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (status) where.status = status
    if (assigned_to) where.assigned_to = assigned_to

    const chores = await prisma!.chore.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { due_date: 'asc' },
    })

    return NextResponse.json({ chores })
  } catch (error) {
    console.error('Error fetching chores:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a chore (family-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = deleteChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'choreId is required' }, { status: 400 })
    }

    // Verify the chore belongs to the user's family
    const chore = await prisma!.chore.findUnique({
      where: { id: parsed.data.choreId },
      select: { family_id: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.chore.delete({
      where: { id: parsed.data.choreId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
