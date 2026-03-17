import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - List messages for current user's family
export async function GET(request: NextRequest) {
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
      return NextResponse.json({ messages: [], members: [] })
    }

    const messages = await prisma!.message.findMany({
      where: { family_id: user.family_id },
      include: {
        sender: {
          select: { name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: 'asc' },
      take: 50,
    })

    const members = await prisma!.user.findMany({
      where: { family_id: user.family_id },
      select: {
        id: true,
        name: true,
        role: true,
        avatar_url: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ messages, members, userId })
  } catch (error) {
    console.error('Error fetching messages:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send a message
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
      return NextResponse.json({ error: 'You must belong to a family' }, { status: 400 })
    }

    const { content, type } = await request.json()

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const message = await prisma!.message.create({
      data: {
        family_id: user.family_id,
        sender_id: userId,
        content: content.trim(),
        type: type || 'text',
        read_by: [userId],
      },
      include: {
        sender: {
          select: { name: true, avatar_url: true },
        },
      },
    })

    return NextResponse.json({ message })
  } catch (error) {
    console.error('Error sending message:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
