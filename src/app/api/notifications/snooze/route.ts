import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'
const schema = z.object({
  notificationId: z.string().min(1).max(200),
  minutes: z.union([z.literal(15), z.literal(60), z.literal(180), z.literal(1440), z.null()]),
}).strict()

/** Idempotent set/clear on the caller's own row; no new delivery or scheduler. */
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error
    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid snooze request' }, { status: 400 })
    const { notificationId, minutes } = parsed.data
    const snoozed_until = minutes === null ? null : new Date(Date.now() + minutes * 60_000)
    const result = await prisma!.notification.updateMany({
      where: { id: notificationId, user_id: payload.userId },
      data: { snoozed_until, read: false },
    })
    if (result.count !== 1) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    return NextResponse.json({ success: true, snoozed_until }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('PATCH /api/notifications/snooze', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
