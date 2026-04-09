import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { updateNotificationSchema, deleteNotificationSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - list notifications for current user
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const userId = payload.userId

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get('unread') === 'true'

    const where: Record<string, unknown> = { user_id: userId }
    if (unreadOnly) {
      where.read = false
    }

    const notifications = await prisma!.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 50,
    })

    return NextResponse.json({ notifications })
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - create a notification (internal use - validates sender is in same family)
export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const { userId, title, message, type } = await request.json()

    if (!userId || !title || !message || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify the caller and target user are in the same family
    const [caller, target] = await Promise.all([
      prisma!.user.findUnique({ where: { id: payload.userId }, select: { family_id: true } }),
      prisma!.user.findUnique({ where: { id: userId }, select: { family_id: true } }),
    ])

    if (!caller || !target || caller.family_id !== target.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const notification = await prisma!.notification.create({
      data: {
        user_id: userId,
        title,
        message,
        type,
        read: false,
      },
    })

    return NextResponse.json({ success: true, notification })
  } catch (error) {
    console.error('Error creating notification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Mark notification(s) as read (user-scoped)
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const userId = payload.userId

    const body = await request.json()
    const parsed = updateNotificationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { notificationId, markAll } = parsed.data

    if (markAll) {
      await prisma!.notification.updateMany({
        where: { user_id: userId, read: false },
        data: { read: true },
      })
    } else if (notificationId) {
      // Verify notification belongs to this user
      const notification = await prisma!.notification.findUnique({
        where: { id: notificationId },
        select: { user_id: true },
      })
      if (!notification || notification.user_id !== userId) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }
      await prisma!.notification.update({
        where: { id: notificationId },
        data: { read: true },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating notification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete notification(s) (user-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const userId = payload.userId

    const body = await request.json()
    const parsed = deleteNotificationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { notificationId, clearAll } = parsed.data

    if (clearAll) {
      await prisma!.notification.deleteMany({
        where: { user_id: userId },
      })
    } else if (notificationId) {
      // Verify notification belongs to this user
      const notification = await prisma!.notification.findUnique({
        where: { id: notificationId },
        select: { user_id: true },
      })
      if (!notification || notification.user_id !== userId) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }
      await prisma!.notification.delete({
        where: { id: notificationId },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting notification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
