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

    const handoff = await prisma!.handoff.create({
      data: {
        family_id: auth.user.family_id,
        sitter_name: sitter_name.trim(),
        sitter_phone: sitter_phone?.trim() || null,
        arrival_time: arrival_time ? new Date(arrival_time) : null,
        departure_time: departure_time ? new Date(departure_time) : null,
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
