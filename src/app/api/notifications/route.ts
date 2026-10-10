import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { updateNotificationSchema, deleteNotificationSchema, sendNotificationSchema } from '@/lib/validations'
import { deliverNotification } from '@/lib/notification-delivery'
import { isParentSendableType } from '@/lib/notification-policy'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

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
    if (searchParams.get('includeSnoozed') !== 'true') {
      where.OR = [{ snoozed_until: null }, { snoozed_until: { lte: new Date() } }]
    }
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
    logRouteError('GET /api/notifications', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - create a notification (internal use - validates sender is in same family)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = sendNotificationSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { userId, title, message, type } = parsed.data
    // Only types in the notification policy table (#286), so every row has a
    // category or is explicitly always-send. Opt-in types (the morning
    // summary, O-40) come only from their own server sender.
    if (!isParentSendableType(type)) {
      return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
    }

    // Verify the caller and target user are in the same family
    const [caller, target] = await Promise.all([
      prisma!.user.findUnique({ where: { id: auth.user.id }, select: { family_id: true } }),
      prisma!.user.findUnique({ where: { id: userId }, select: { family_id: true } }),
    ])

    if (!caller || !target || caller.family_id !== target.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // The recipient's notification preferences apply (#286): a muted category
    // creates nothing and answers `delivered: false`. `system` is always sent.
    // A delivered notification adds `quiet` (#141, O-32): true when it was
    // stored during the recipient's quiet hours and must not interrupt them.
    const result = await deliverNotification({ userId, title, message, type, familyId: auth.user.family_id, senderId: auth.user.id })

    if (!result.delivered) {
      return NextResponse.json({ success: true, delivered: false, notification: null })
    }
    return NextResponse.json({
      success: true,
      delivered: true,
      notification: result.notification,
      quiet: result.quiet,
    })
  } catch (error) {
    logRouteError('POST /api/notifications', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Mark notification(s) as read (user-scoped)
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const userId = payload.userId

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
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
    logRouteError('PATCH /api/notifications', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete notification(s) (user-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const userId = payload.userId

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
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
    logRouteError('DELETE /api/notifications', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
