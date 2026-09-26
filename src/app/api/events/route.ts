import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { createEventSchema, updateEventSchema, deleteEventSchema } from '@/lib/validations'
import { attachEventSources, EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'

export const dynamic = 'force-dynamic'

// GET - List events for the user's family, or fetch one with ?id=
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)

    const id = searchParams.get('id')
    if (id) {
      const event = await prisma!.event.findUnique({
        where: { id },
        include: {
          creator: { select: { id: true, name: true } },
        },
      })
      if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      const familyError = requireFamilyMatch(event.family_id, auth.user.family_id)
      if (familyError) return familyError
      const [withSource] = await attachEventSources(prisma!, auth.user.family_id, [event])
      return NextResponse.json({ event: withSource })
    }

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

    // Imported events carry `source` ({ subscription_id, name, color }) and are read-only (#232).
    return NextResponse.json({ events: await attachEventSources(prisma!, auth.user.family_id, events) })
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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { title, description, start_time, end_time, location, event_type, recurrence } = parsed.data

    const startDate = new Date(start_time)
    const endDate = end_time ? new Date(end_time) : startDate

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid start or end time' }, { status: 400 })
    }

    if (endDate < startDate) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
    }

    // Create the event and its activity record atomically
    const event = await prisma!.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          family_id: auth.user.family_id,
          title,
          description: description || null,
          start_time: startDate,
          end_time: endDate,
          location: location || null,
          event_type,
          recurrence: recurrence || null,
          created_by: auth.user.id,
        },
      })

      // Record activity
      await tx.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: auth.user.id,
          type: 'event_created',
          title: `${auth.user.name} added "${title}" to the calendar`,
          metadata: JSON.stringify({ eventId: created.id }),
        },
      })

      return created
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

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { eventId, ...updates } = parsed.data

    const event = await prisma!.event.findUnique({
      where: { id: eventId },
      select: { family_id: true, start_time: true, end_time: true, source_subscription_id: true },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(event.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Imported events are owned by their source calendar (#232).
    if (event.source_subscription_id) {
      return NextResponse.json({ error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE }, { status: 409 })
    }

    const newStart = updates.start_time !== undefined ? new Date(updates.start_time) : undefined
    const newEnd = updates.end_time !== undefined ? new Date(updates.end_time) : undefined
    if ((newStart && isNaN(newStart.getTime())) || (newEnd && isNaN(newEnd.getTime()))) {
      return NextResponse.json({ error: 'Invalid start or end time' }, { status: 400 })
    }

    // Validate the merged range when either bound changes
    if (newStart || newEnd) {
      const effectiveStart = newStart ?? event.start_time
      const effectiveEnd = newEnd ?? event.end_time
      if (effectiveEnd && effectiveEnd < effectiveStart) {
        return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
      }
    }

    const data: Record<string, unknown> = {}
    if (updates.title !== undefined) data.title = updates.title
    if (updates.description !== undefined) data.description = updates.description
    if (newStart) data.start_time = newStart
    if (newEnd) data.end_time = newEnd
    if (updates.location !== undefined) data.location = updates.location
    if (updates.event_type !== undefined) data.event_type = updates.event_type
    if (updates.recurrence !== undefined) data.recurrence = updates.recurrence

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

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    }

    const event = await prisma!.event.findUnique({
      where: { id: parsed.data.eventId },
      select: { family_id: true, source_subscription_id: true },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(event.family_id, auth.user.family_id)
    if (familyError) return familyError

    // Imported events are removed by removing their subscription (#232).
    if (event.source_subscription_id) {
      return NextResponse.json({ error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE }, { status: 409 })
    }

    await prisma!.event.delete({ where: { id: parsed.data.eventId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
