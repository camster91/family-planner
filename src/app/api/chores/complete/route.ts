import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = payload.userId as string

    const { choreId, photoUrl } = await request.json()

    if (!choreId) {
      return NextResponse.json({ error: 'Missing choreId' }, { status: 400 })
    }

    // Get the chore details
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: { assignee: true, creator: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    // Update chore status to completed
    const updateData: any = {
      status: 'completed',
      completed_at: new Date()
    }

    if (photoUrl) {
      updateData.photo_url = photoUrl
      updateData.photo_verified = false // Requires parent verification
    }

    await prisma!.chore.update({
      where: { id: choreId },
      data: updateData
    })

    // Send notification about chore completion
    if (chore.assignee && chore.creator) {
      await notificationServiceServer.notifyChoreCompletion(
        chore,
        chore.assignee
      )
    }

    // Handle recurring chores
    if (chore.frequency && chore.frequency !== 'once') {
      await createNextRecurringChore(chore)
    }

    return NextResponse.json({ success: true, choreId })

  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function createNextRecurringChore(chore: any) {
  const dueDate = new Date(chore.due_date)
  let nextDueDate: Date

  switch (chore.frequency) {
    case 'daily':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 1)
      break
    case 'weekly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 7)
      break
    case 'monthly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setMonth(nextDueDate.getMonth() + 1)
      break
    default:
      return
  }

  // Create next instance
  try {
    await prisma!.chore.create({
      data: {
        family_id: chore.family_id,
        title: chore.title,
        description: chore.description,
        points: chore.points,
        assigned_to: chore.assigned_to,
        due_date: nextDueDate,
        status: 'pending',
        frequency: chore.frequency,
        difficulty: chore.difficulty,
        created_by: chore.created_by,
      }
    })
  } catch (error) {
    console.error('Error creating recurring chore:', error)
  }
}
