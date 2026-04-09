import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { sendMessageSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - List messages for current user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (cursor) {
      where.created_at = { lt: new Date(cursor) }
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
    console.error('Error fetching messages:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
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
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
