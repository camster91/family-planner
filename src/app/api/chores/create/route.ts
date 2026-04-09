import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { createChoreSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, points, assigned_to, due_date, difficulty, frequency } = parsed.data

    // Verify the assigned user belongs to the same family
    const assignee = await prisma!.user.findUnique({
      where: { id: assigned_to },
      select: { id: true, family_id: true, name: true },
    })

    if (!assignee || assignee.family_id !== auth.user.family_id) {
      return NextResponse.json({ error: 'Assigned user must be in your family' }, { status: 400 })
    }

    const newChore = await prisma!.chore.create({
      data: {
        family_id: auth.user.family_id,
        title,
        description: description || null,
        points,
        assigned_to,
        due_date: new Date(due_date),
        difficulty,
        frequency,
        status: 'pending',
        created_by: auth.user.id,
      },
      include: {
        assignee: true,
        creator: true,
      },
    })

    // Send notification to assigned user
    if (newChore.assignee && newChore.creator) {
      try {
        await notificationServiceServer.notifyChoreAssignment(
          newChore,
          newChore.assignee,
          newChore.creator
        )
      } catch (err) {
        console.error('Error sending chore assignment notification:', err)
      }
    }

    return NextResponse.json({ chore: newChore })
  } catch (error) {
    console.error('Error creating chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
