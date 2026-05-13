import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET - Single chore details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = params

    const chore = await prisma!.chore.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true } },
        creator: { select: { id: true, name: true } },
      },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    return NextResponse.json({ chore })
  } catch (error) {
    console.error('Error fetching chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a single chore (family-scoped, parent or assignee)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = params

    const body = await request.json()
    const updates = body as Record<string, unknown>

    const chore = await prisma!.chore.findUnique({
      where: { id },
      select: { family_id: true, assigned_to: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json(
        { error: 'Only parents or the assignee can edit chores' },
        { status: 403 }
      )
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.points !== undefined) data.points = updates.points
    if (updates.assigned_to !== undefined) data.assigned_to = updates.assigned_to
    if (updates.due_date !== undefined) data.due_date = new Date(updates.due_date as string)
    if (updates.difficulty !== undefined) data.difficulty = updates.difficulty
    if (updates.frequency !== undefined) data.frequency = updates.frequency

    const updated = await prisma!.chore.update({
      where: { id },
      data,
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true } },
        creator: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ chore: updated })
  } catch (error) {
    console.error('Error updating chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a single chore (family-scoped)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = params

    const chore = await prisma!.chore.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.chore.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
