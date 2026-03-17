import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { family_id: true },
    })

    if (!user?.family_id) {
      return NextResponse.json({ error: 'You must belong to a family to create chores' }, { status: 400 })
    }

    const { title, description, points, assigned_to, due_date, difficulty, frequency } = await request.json()

    if (!title || !assigned_to || !due_date) {
      return NextResponse.json({ error: 'Title, assigned_to, and due_date are required' }, { status: 400 })
    }

    const newChore = await prisma!.chore.create({
      data: {
        family_id: user.family_id,
        title,
        description: description || null,
        points: points || 10,
        assigned_to,
        due_date: new Date(due_date),
        difficulty: difficulty || 'medium',
        frequency: frequency || 'once',
        status: 'pending',
        created_by: userId,
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
