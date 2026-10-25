import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'
const FEED_MAX_EVENTS = 2000

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// Fold by UTF-8 octets, never UTF-16 code units. Retain the prior conservative
// ASCII widths (74 first-line bytes; 73 plus the continuation space), below 75.
function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 74) return line
  const parts: string[] = []
  let segment = ''
  let bytes = 0
  let width = 74
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > width) {
      parts.push(parts.length ? ' ' + segment : segment)
      segment = ''
      bytes = 0
      width = 73
    }
    segment += character
    bytes += size
  }
  if (segment) parts.push(parts.length ? ' ' + segment : segment)
  return parts.join('\r\n')
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// GET /api/calendar/feed?token=<feed_token>
// Read-only ICS feed any calendar app can subscribe to.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing feed token' }, { status: 401 })
    }

    const family = await prisma!.family.findFirst({
      where: { feed_token: token },
      select: { id: true, name: true },
    })
    if (!family) {
      return NextResponse.json({ error: 'Invalid feed token' }, { status: 401 })
    }

    // Keep the feed bounded: recent past through the near future.
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

    const events = await prisma!.event.findMany({
      where: {
        family_id: family.id,
        OR: [
          // Recurring series stay in the feed regardless of age so subscribers
          // keep expanding future occurrences from their RRULE.
          { recurrence: { not: null } },
          { start_time: { gte: from, lte: to } },
        ],
      },
      orderBy: { start_time: 'asc' },
      take: FEED_MAX_EVENTS + 1,
    })

    // A partial successful calendar can make subscribers interpret omitted
    // events as deletions. Refuse before emitting any ICS instead of truncating.
    if (events.length > FEED_MAX_EVENTS) {
      return NextResponse.json({
        code: 'CALENDAR_FEED_TOO_LARGE',
        error: 'This calendar is too large to export completely right now.',
      }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
    }

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Family Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      fold(`X-WR-CALNAME:${escapeIcs(family.name)}`),
    ]

    for (const e of events) {
      const end = e.end_time && e.end_time > e.start_time ? e.end_time : e.start_time
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${e.id}@family.ashbi.ca`)
      lines.push(`DTSTAMP:${stamp(e.created_at)}`)
      lines.push(`DTSTART:${stamp(e.start_time)}`)
      lines.push(`DTEND:${stamp(end)}`)
      lines.push(fold(`SUMMARY:${escapeIcs(e.title)}`))
      if (e.description) lines.push(fold(`DESCRIPTION:${escapeIcs(e.description)}`))
      if (e.location) lines.push(fold(`LOCATION:${escapeIcs(e.location)}`))
      // Values may arrive with or without the RRULE: prefix — never emit both.
      if (e.recurrence)
        lines.push(fold(`RRULE:${e.recurrence.replace(/^RRULE:/i, '').toUpperCase()}`))
      lines.push('END:VEVENT')
    }

    lines.push('END:VCALENDAR')

    return new NextResponse(lines.join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    logRouteError('GET /api/calendar/feed', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
