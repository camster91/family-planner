import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { deleteChoreSchema, updateChoreSchema } from '@/lib/validations'
import { normalizeDateOnlyInput } from '@/lib/dates'
import { resolveChorePhotoForWrite } from '@/lib/chore-photos'

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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, ...updates } = parsed.data

    // due_date is a date-only value (UTC midnight). Accept `YYYY-MM-DD` or a
    // timestamp, but always store the UTC calendar day, never a time of day.
    let dueDate: Date | undefined
    if (updates.due_date !== undefined) {
      const normalized = normalizeDateOnlyInput(updates.due_date)
      if (!normalized) {
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
      }
      dueDate = normalized
    }

    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      select: { family_id: true, assigned_to: true, photo_url: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can edit chores' }, { status: 403 })
    }

    // Fields a non-parent assignee must not change (#185).
    //
    // The assignee may edit their own chore, but `points` decides how much XP
    // verify awards and `assigned_to` decides who receives it. Letting a child
    // set either meant they could inflate points before verification, or point
    // the chore at any user id they could guess. Both are privilege boundaries,
    // not cosmetic edits. `difficulty` feeds the XP multiplier the same way,
    // so it is parent-only too.
    const PARENT_ONLY_FIELDS = ['points', 'difficulty', 'assigned_to', 'frequency'] as const
    if (auth.user.role !== 'parent') {
      const attempted = PARENT_ONLY_FIELDS.filter((f) => updates[f] !== undefined)
      if (attempted.length > 0) {
        return NextResponse.json(
          { error: `Only parents can change: ${attempted.join(', ')}` },
          { status: 403 }
        )
      }
    }

    // A new assignee must be a member of the same family, whatever the caller's
    // role. Without this a parent could accidentally (or a crafted request could
    // deliberately) assign a chore to a user in another household.
    if (updates.assigned_to !== undefined) {
      if (updates.assigned_to !== chore.assigned_to) {
        const assignee = await prisma!.user.findFirst({
          where: { id: updates.assigned_to, family_id: auth.user.family_id },
          select: { id: true },
        })
        if (!assignee) {
          return NextResponse.json(
            { error: 'Assignee must be a member of your family' },
            { status: 400 }
          )
        }
      }
    }

    // D3 (#102): a new photo must be an upload owned by the caller's family.
    // Re-sending the chore's current value (an edit form posting back what it
    // loaded, including a legacy file with no Upload row) is left unchanged.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, updates.photo_url, chore.photo_url)
    if (!photo.ok) {
      return NextResponse.json({ error: photo.error }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.points !== undefined) data.points = updates.points
    if (updates.assigned_to !== undefined) data.assigned_to = updates.assigned_to
    if (dueDate !== undefined) data.due_date = dueDate
    if (updates.difficulty !== undefined) data.difficulty = updates.difficulty
    if (updates.frequency !== undefined) data.frequency = updates.frequency
    if (photo.value !== undefined) data.photo_url = photo.value

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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'choreId is required' }, { status: 400 })
    }

    // Verify the chore belongs to the user's family
    const chore = await prisma!.chore.findUnique({
      where: { id: parsed.data.choreId },
      select: { family_id: true, assigned_to: true },
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (auth.user.role !== 'parent' && chore.assigned_to !== auth.user.id) {
      return NextResponse.json({ error: 'Only parents or the assignee can delete chores' }, { status: 403 })
    }

    await prisma!.chore.delete({
      where: { id: parsed.data.choreId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
