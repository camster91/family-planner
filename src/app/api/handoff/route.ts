import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { shapeHandoffForRole } from '@/lib/role-capabilities'

export const dynamic = 'force-dynamic'

// Share links are unauthenticated, so they must be unguessable and short-lived.
// 128-bit token like /api/handoff/[id]/regenerate-token. The link lives for at
// least 6h, stretches to 6h after the planned departure so a handoff prepared
// in advance still works, and never beyond 7 days.
const SHARE_TOKEN_TTL_MS = 6 * 60 * 60 * 1000
const SHARE_TOKEN_MAX_MS = 7 * 24 * 60 * 60 * 1000

function shareExpiry(departure: Date | null): Date {
  const now = Date.now()
  const afterDeparture = departure && !isNaN(departure.getTime()) ? departure.getTime() + SHARE_TOKEN_TTL_MS : 0
  return new Date(Math.min(Math.max(now + SHARE_TOKEN_TTL_MS, afterDeparture), now + SHARE_TOKEN_MAX_MS))
}

// GET /api/handoff - List all handoffs for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'handoff')
    if (gate) return gate

    const handoffs = await prisma!.handoff.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: 'desc' },
    })

    // D2 (#102): parents get every field. Teens get everything except the
    // share token (a bearer credential for the public sitter page). Children
    // get only who is coming and when (CHILD_HANDOFF_FIELDS).
    return NextResponse.json({
      handoffs: handoffs.map((h) => shapeHandoffForRole(h, auth.user.role)),
    })
  } catch (err) {
    console.error('GET /api/handoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/handoff - Create a new handoff (parent only)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'handoff')
    if (gate) return gate

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const {
      sitter_name,
      sitter_phone,
      arrival_time,
      departure_time,
      kids_bedtimes,
      where_snacks,
      pickup_authorized,
      code_words,
      pet_care,
      emergency_notes,
      house_notes,
      general_notes,
    } = body

    if (!sitter_name || typeof sitter_name !== 'string' || sitter_name.trim() === '') {
      return NextResponse.json({ error: 'Sitter name is required' }, { status: 400 })
    }

    // Validate datetime fields. datetime-local inputs produce "YYYY-MM-DDTHH:MM"
    // strings. If a user types garbage, new Date() returns Invalid Date which
    // Prisma rejects. Guard with a parse check.
    const parseDate = (v: unknown): Date | null => {
      if (!v || typeof v !== 'string') return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    }
    const parsedArrival = parseDate(arrival_time)
    const parsedDeparture = parseDate(departure_time)
    if (arrival_time && !parsedArrival) {
      return NextResponse.json({ error: 'Invalid arrival_time format. Use the date/time picker.' }, { status: 400 })
    }
    if (departure_time && !parsedDeparture) {
      return NextResponse.json({ error: 'Invalid departure_time format. Use the date/time picker.' }, { status: 400 })
    }

    const handoff = await prisma!.handoff.create({
      data: {
        family_id: auth.user.family_id,
        sitter_name: sitter_name.trim(),
        sitter_phone: sitter_phone?.trim() || null,
        arrival_time: parsedArrival,
        departure_time: parsedDeparture,
        kids_bedtimes: kids_bedtimes?.trim() || null,
        where_snacks: where_snacks?.trim() || null,
        pickup_authorized: pickup_authorized?.trim() || null,
        code_words: code_words?.trim() || null,
        pet_care: pet_care?.trim() || null,
        emergency_notes: emergency_notes?.trim() || null,
        house_notes: house_notes?.trim() || null,
        general_notes: general_notes?.trim() || null,
        share_token: randomBytes(16).toString('hex'),
        share_expires_at: shareExpiry(parsedDeparture),
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ handoff }, { status: 201 })
  } catch (err) {
    console.error('POST /api/handoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
