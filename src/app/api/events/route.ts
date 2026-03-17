import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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
      return NextResponse.json({ error: 'You must belong to a family to create events' }, { status: 400 })
    }

    const { title, description, start_time, end_time, location } = await request.json()

    if (!title || !start_time) {
      return NextResponse.json({ error: 'Title and start time are required' }, { status: 400 })
    }

    const event = await prisma!.event.create({
      data: {
        family_id: user.family_id,
        title,
        description: description || null,
        start_time: new Date(start_time),
        end_time: end_time ? new Date(end_time) : new Date(start_time),
        location: location || null,
        created_by: userId,
      },
    })

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Error creating event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
