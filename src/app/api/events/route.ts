import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createEventSchema, updateEventSchema, deleteEventSchema } from '@/lib/validations'

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

// PATCH - Update an event (family-scoped)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = updateEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { eventId, ...updates } = parsed.data

    const event = await prisma!.event.findUnique({
      where: { id: eventId },
      select: { family_id: true },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(event.family_id, auth.user.family_id)
    if (familyError) return familyError

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (updates.start_time !== undefined) data.start_time = new Date(updates.start_time)
    if (updates.end_time !== undefined) data.end_time = new Date(updates.end_time)
    if (updates.location !== undefined) data.location = updates.location
    if (updates.event_type !== undefined) data.event_type = updates.event_type

    const updated = await prisma!.event.update({
      where: { id: eventId },
      data,
      include: { creator: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ event: updated })
  } catch (error) {
    console.error('Error updating event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete an event (family-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = deleteEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    }

    const event = await prisma!.event.findUnique({
      where: { id: parsed.data.eventId },
      select: { family_id: true },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(event.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.event.delete({ where: { id: parsed.data.eventId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
