import type { Prisma, Notification } from '@prisma/client'
import { storageBackend } from '@/lib/storage-backend'
import { withD1ReadClient } from '@/lib/cloudflare/read-client'
import { readD1NotificationInbox, mutateD1NotificationInbox } from '@/lib/cloudflare/notification-inbox'
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body"
import { parseNotificationPaging, afterNotificationCursor, encodeNotificationCursor } from "@/lib/notification-paging"
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
    const includeSnoozed = searchParams.get('includeSnoozed') === 'true'
    const scope = { userId, unreadOnly, includeSnoozed }
    const paging = parseNotificationPaging(searchParams, scope)
    if (!paging.ok) return NextResponse.json({ error: paging.error }, { status: 400 })

    const where: Prisma.NotificationWhereInput = { user_id: userId }
    if (!includeSnoozed) {
      where.OR = [{ snoozed_until: null }, { snoozed_until: { lte: new Date() } }]
    }
    if (unreadOnly) {
      where.read = false
    }

    if (paging.paged && paging.cursor) where.AND = [afterNotificationCursor(paging.cursor)]
    const native = storageBackend() === 'd1'
      ? await readD1NotificationInbox({ userId, generation: payload.tv ?? 0 }, where, paging.paged ? paging.limit + 1 : 50)
      : null
    if (native && native.status !== 200) return NextResponse.json(native.body, { status: native.status, headers: { 'Cache-Control': 'private, no-store' } })
    const rows = native ? native.body as Notification[] : await prisma!.notification.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: paging.paged ? paging.limit + 1 : 50,
    })
    const notifications = paging.paged ? rows.slice(0, paging.limit) : rows
    return NextResponse.json(paging.paged ? {
      notifications,
      nextCursor: rows.length > paging.limit
        ? encodeNotificationCursor(scope, notifications[notifications.length - 1]) : null,
    } : { notifications }, { headers: { 'Cache-Control': 'private, no-store' } })
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
      payload = await readBoundedJson(request, 16 * 1024)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
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
    const readParticipants = (db: Pick<NonNullable<typeof prisma>, 'user'>) => Promise.all([
      db.user.findUnique({ where: { id: auth.user.id }, select: { family_id: true } }),
      db.user.findUnique({ where: { id: userId }, select: { family_id: true } }),
    ])
    const [caller, target] = storageBackend() === 'd1'
      ? await withD1ReadClient(db => readParticipants(db as unknown as Pick<NonNullable<typeof prisma>, 'user'>))
      : await readParticipants(prisma!)

    if (!caller || !target || caller.family_id !== target.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // The recipient's notification preferences apply (#286): a muted category
    // creates nothing and answers `delivered: false`. `system` is always sent.
    // A delivered notification adds `quiet` (#141, O-32): true when it was
    // stored during the recipient's quiet hours and must not interrupt them.
    const result = await deliverNotification({ userId, title, message, type, familyId: auth.user.family_id, senderId: auth.user.id, ...(storageBackend() === 'd1' ? { senderContext: { role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 } } : {}) })

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

    let body: unknown
    try {
      body = await readBoundedJson(request, 8 * 1024)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
    }
    const parsed = updateNotificationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { notificationId, markAll } = parsed.data

    if (storageBackend() === 'd1' && (markAll || notificationId)) {
      const result = await mutateD1NotificationInbox({ userId, generation: payload.tv ?? 0 }, markAll ? { kind: 'read-all' } : { kind: 'read', id: notificationId! })
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
    }

    if (markAll) {
      await prisma!.notification.updateMany({
        where: { user_id: userId, read: false },
        data: { read: true },
      })
    } else if (notificationId) {
      // Ownership is part of the write, not a separate stale preflight read.
      const changed = await prisma!.notification.updateMany({
        where: { id: notificationId, user_id: userId },
        data: { read: true },
      })
      if (changed.count !== 1) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }
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

    let body: unknown
    try {
      body = await readBoundedJson(request, 8 * 1024)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 })
    }
    const parsed = deleteNotificationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { notificationId, clearAll } = parsed.data

    if (storageBackend() === 'd1' && (clearAll || notificationId)) {
      const result = await mutateD1NotificationInbox({ userId, generation: payload.tv ?? 0 }, clearAll ? { kind: 'delete-all' } : { kind: 'delete', id: notificationId! })
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
    }

    if (clearAll) {
      await prisma!.notification.deleteMany({
        where: { user_id: userId },
      })
    } else if (notificationId) {
      const changed = await prisma!.notification.deleteMany({
        where: { id: notificationId, user_id: userId },
      })
      if (changed.count !== 1) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logRouteError('DELETE /api/notifications', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
