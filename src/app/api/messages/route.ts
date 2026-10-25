import { parseMessagePaging, afterMessageCursor, encodeMessageCursor } from '@/lib/message-paging'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { sendMessageSchema, markMessagesReadSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeMessageActorInTx, createMessageEffect, MESSAGE_INCLUDE, toMessageResponse } from '@/lib/message-mutations'
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/bounded-body'

export const dynamic = 'force-dynamic'
const MESSAGE_READ_BODY_MAX_BYTES = 256 * 1024

// GET - List messages for current user's family
export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const modern = searchParams.has('paging')
    const paging = modern ? parseMessagePaging(searchParams, auth.user.family_id) : null
    if (paging && !paging.ok) return NextResponse.json({ error: paging.error, code: 'MESSAGES_INVALID_PAGE' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
    const cursor = modern ? null : searchParams.get('cursor')
    const rawLimit = modern ? null : searchParams.get('limit')
    let limit = 50
    if (rawLimit !== null && rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit.trim())) {
        return NextResponse.json({ error: 'limit must be a whole number' }, { status: 400 })
      }
      // Clamp to 1..100 rather than refusing an out-of-range page size.
      limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 100)
    }

    if (paging?.ok) limit = paging.limit
    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (paging?.ok && paging.cursor) where.AND = [afterMessageCursor(paging.cursor)]
    if (cursor) {
      const before = new Date(cursor)
      if (Number.isNaN(before.getTime())) {
        return NextResponse.json({ error: 'cursor must be a valid date-time' }, { status: 400 })
      }
      where.created_at = { lt: before }
    }

    const rows = await prisma!.message.findMany({
      where,
      include: MESSAGE_INCLUDE,
      orderBy: modern ? [{ created_at: 'desc' }, { id: 'asc' }] : { created_at: 'desc' },
      take: modern ? limit + 1 : limit,
    })
    // Cursor position comes from the complete descending page before the DTO
    // is reversed for chronological presentation. No pivot row lookup needed.
    const messages = modern ? rows.slice(0, limit) : rows
    const nextCursor = modern && rows.length > limit && messages.length
      ? encodeMessageCursor(auth.user.family_id, messages[messages.length - 1]) : null

    const members = await prisma!.user.findMany({
      where: { family_id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        role: true,
        avatar_url: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      messages: messages.reverse().map(toMessageResponse), // Return in chronological order
      members,
      userId: auth.user.id,
      ...(modern ? { nextCursor } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('GET /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = sendMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${auth.user.id}`, familyId: auth.user.family_id, userId: auth.user.id, action: 'message.create' },
      parsed.data,
      ({ recordId }) => createMessageEffect(
        prisma!,
        { id: auth.user.id, familyId: auth.user.family_id },
        parsed.data,
        recordId,
      ),
      {
        beforeReplay: () => prisma!.$transaction(async (tx) =>
          authorizeMessageActorInTx(tx, { id: auth.user.id, familyId: auth.user.family_id }),
        ),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logRouteError('POST /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Mark messages as read
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    let body: unknown
    try {
      body = await readBoundedJson(request, MESSAGE_READ_BODY_MAX_BYTES)
    } catch (caught) {
      return NextResponse.json(
        { error: caught instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON' },
        { status: caught instanceof RequestBodyTooLargeError ? 413 : 400 },
      )
    }
    const parsed = markMessagesReadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { messageIds, markAll } = parsed.data

    if (markAll) {
      // Mark all unread family messages as read by this user
      await prisma!.message.updateMany({
        where: {
          family_id: auth.user.family_id,
          NOT: { read_by: { has: auth.user.id } },
        },
        data: {
          read_by: { push: auth.user.id },
        },
      })
    } else if (messageIds && messageIds.length > 0) {
      // Mark specific messages as read
      await prisma!.message.updateMany({
        where: {
          id: { in: messageIds },
          family_id: auth.user.family_id,
          NOT: { read_by: { has: auth.user.id } },
        },
        data: {
          read_by: { push: auth.user.id },
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logRouteError('PATCH /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
