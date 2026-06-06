import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET /api/handoff - List all handoffs for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const handoffs = await prisma!.handoff.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ handoffs })
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

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json()
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
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ handoff }, { status: 201 })
  } catch (err) {
    console.error('POST /api/handoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
