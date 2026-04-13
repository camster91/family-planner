import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { deleteChoreSchema, updateChoreSchema } from '@/lib/validations'

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

// PATCH - Update a chore (family-scoped, parent or assignee)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = updateChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, ...updates } = parsed.data

    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      select: { family_id: true, assigned_to: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can edit chores' }, { status: 403 })
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.points !== undefined) data.points = updates.points
    if (updates.assigned_to !== undefined) data.assigned_to = updates.assigned_to
    if (updates.due_date !== undefined) data.due_date = new Date(updates.due_date)
    if (updates.difficulty !== undefined) data.difficulty = updates.difficulty
    if (updates.frequency !== undefined) data.frequency = updates.frequency

    const updated = await prisma!.chore.update({
      where: { id: choreId },
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
