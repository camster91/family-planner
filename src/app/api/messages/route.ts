import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { sendMessageSchema, markMessagesReadSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// GET - List messages for current user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')
    const rawLimit = searchParams.get('limit')
    let limit = 50
    if (rawLimit !== null && rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit.trim())) {
        return NextResponse.json({ error: 'limit must be a whole number' }, { status: 400 })
      }
      // Clamp to 1..100 rather than refusing an out-of-range page size.
      limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 100)
    }

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (cursor) {
      const before = new Date(cursor)
      if (Number.isNaN(before.getTime())) {
        return NextResponse.json({ error: 'cursor must be a valid date-time' }, { status: 400 })
      }
      where.created_at = { lt: before }
    }

    const messages = await prisma!.message.findMany({
      where,
      include: {
        sender: {
          select: { id: true, name: true, avatar_url: true, role: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

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
      messages: messages.reverse(), // Return in chronological order
      members,
      userId: auth.user.id,
    })
  } catch (error) {
    logRouteError('GET /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = sendMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { content, type } = parsed.data

    const message = await prisma!.message.create({
      data: {
        family_id: auth.user.family_id,
        sender_id: auth.user.id,
        content,
        type,
        read_by: [auth.user.id],
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar_url: true, role: true },
        },
      },
    })

    return NextResponse.json({ message })
  } catch (error) {
    logRouteError('POST /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Mark messages as read
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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
