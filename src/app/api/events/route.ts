import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { createEventSchema, updateEventSchema, deleteEventSchema } from '@/lib/validations'
import { attachEventSources, EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'
import { recordBetaMetric } from '@/lib/beta-metrics'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { CalendarRangeError, encodeCalendarCursor, parseCalendarRange } from '@/lib/calendar-planning/range'

export const dynamic = 'force-dynamic'

/** GET without `upcoming`: how far back the list reaches (by event end). */
const LIST_WINDOW_PAST_DAYS = 30

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

    let range
    try {
      range = parseCalendarRange(searchParams, auth.user.family_id)
    } catch (error) {
      if (error instanceof CalendarRangeError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }
    if (range) {
      const { start, end, limit, after } = range
      const events = await prisma!.event.findMany({
        where: {
          family_id: auth.user.family_id,
          OR: [
            { start_time: { gte: start, lt: end } },
            { start_time: { lt: start }, end_time: { gt: start } },
          ],
          ...(after ? { AND: [{ OR: [
            { start_time: { gt: after.start } },
            { start_time: after.start, id: { gt: after.id } },
          ] }] } : {}),
        },
        include: { creator: { select: { id: true, name: true } } },
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      })
      const page = events.slice(0, limit)
      const hasMore = events.length > limit
      return NextResponse.json({
        events: await attachEventSources(prisma!, auth.user.family_id, page),
        nextCursor: hasMore ? encodeCalendarCursor(auth.user.family_id, range, page[page.length - 1]) : null,
        hasMore,
      })
    }

    const upcoming = searchParams.get('upcoming') === 'true'

    // `upcoming=true`: events starting from now. Otherwise a recent window:
    // events that end no earlier than LIST_WINDOW_PAST_DAYS ago (so ongoing
    // and recently finished ones are included), oldest first. Without the
    // window the list was the household's 100 OLDEST events ever, which hid
    // everything current once a household had more than 100.
    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (upcoming) {
      where.start_time = { gte: new Date() }
    } else {
      // A repeating event is one row holding its first occurrence, so keep
      // every repeating event regardless of when the first one ended.
      where.OR = [
        { end_time: { gte: new Date(Date.now() - LIST_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000) } },
        { recurrence: { not: null } },
      ]
    }

    const events = await prisma!.event.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true } },
      },
      orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
      take: 100,
    })

    // Imported events carry `source` ({ subscription_id, name, color }) and are read-only (#232).
    return NextResponse.json({ events: await attachEventSources(prisma!, auth.user.family_id, events) })
  } catch (error) {
    logRouteError('GET /api/events', error, getRequestId(request))
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

    // Beta usage counts (#287): after the commit; never fails the request.
    await recordBetaMetric(prisma!, auth.user.family_id, 'event_created')

    return NextResponse.json({ event })
  } catch (error) {
    logRouteError('POST /api/events', error, getRequestId(request))
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
    logRouteError('PATCH /api/events', error, getRequestId(request))
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
    logRouteError('DELETE /api/events', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
