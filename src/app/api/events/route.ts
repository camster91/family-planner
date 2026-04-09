import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createEventSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET - List events for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const upcoming = searchParams.get('upcoming') === 'true'

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (upcoming) {
      where.start_time = { gte: new Date() }
    }

    const events = await prisma!.event.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true } },
      },
      orderBy: { start_time: 'asc' },
      take: 100,
    })

    return NextResponse.json({ events })
  } catch (error) {
    console.error('Error fetching events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create an event
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, start_time, end_time, location, event_type } = parsed.data

    const startDate = new Date(start_time)
    const endDate = end_time ? new Date(end_time) : startDate

    if (endDate < startDate) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
    }

    const event = await prisma!.event.create({
      data: {
        family_id: auth.user.family_id,
        title,
        description: description || null,
        start_time: startDate,
        end_time: endDate,
        location: location || null,
        event_type,
        created_by: auth.user.id,
      },
    })

    // Record activity
    await prisma!.activity.create({
      data: {
        family_id: auth.user.family_id,
        user_id: auth.user.id,
        type: 'event_created',
        title: `${auth.user.name} added "${title}" to the calendar`,
        metadata: JSON.stringify({ eventId: event.id }),
      },
    })

    return NextResponse.json({ event })
  } catch (error) {
    console.error('Error creating event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
