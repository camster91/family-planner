import { authorizeMessageActorInTx } from '@/lib/message-authority'
import { postMessage } from '@/lib/message-create-http'
import { MESSAGE_OWNER_PROTOCOL } from '@/lib/message-owner-contract'
import { parseMessagePaging, afterMessageCursor, encodeMessageCursor } from '@/lib/message-paging'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { markMessagesReadSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { MESSAGE_INCLUDE, toMessageResponse } from '@/lib/message-mutations'
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/bounded-body'
import { storageBackend } from '@/lib/storage-backend'
import { markD1MessagesRead, readD1Messages } from '@/lib/cloudflare/messages'

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
    if (storageBackend() === 'd1') {
      let legacyCursor: Date | null = null
      if (!modern && cursor) {
        legacyCursor = new Date(cursor)
        if (Number.isNaN(legacyCursor.getTime())) {
          return NextResponse.json({ error: 'cursor must be a valid date-time' }, { status: 400 })
        }
      }
      const result = await readD1Messages(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        { modern, limit, cursor: legacyCursor, paging },
      )
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
    }
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
      ...(modern ? { nextCursor, readContext: { userId: auth.user.id, familyId: auth.user.family_id }, writeContext: { protocol: MESSAGE_OWNER_PROTOCOL, userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 } } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('GET /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Legacy clients keep their original endpoint/body contract.
export async function POST(request: NextRequest) { return postMessage(request) }

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

    if (storageBackend() === 'd1') {
      const result = await markD1MessagesRead(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        { messageIds, markAll },
      )
      return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
    }

    const result = await prisma!.$transaction(async tx => {
      // Match erasure's user -> household order before appending a plain
      // read_by ID; a late acknowledgment cannot resurrect an erased actor.
      const refusal = await authorizeMessageActorInTx(tx, { id: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 })
      if (refusal) return refusal
      if (markAll) {
        // Mark all unread family messages as read by this user
        await tx.message.updateMany({
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
        await tx.message.updateMany({
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

      return { status: 200, body: { success: true } }
    })
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('PATCH /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
