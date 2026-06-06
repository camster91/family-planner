import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH /api/handoff/[id] - Update a handoff (parent only, family-scoped)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params

    const existing = await prisma!.handoff.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const matchError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (matchError) return matchError

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

    // Same datetime validation as POST — see POST handler for the rationale.
    const parseDate = (v: unknown): Date | null => {
      if (!v || typeof v !== 'string') return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    }
    if (arrival_time !== undefined && arrival_time !== null) {
      if (typeof arrival_time !== 'string' || !parseDate(arrival_time)) {
        return NextResponse.json({ error: 'Invalid arrival_time format' }, { status: 400 })
      }
    }
    if (departure_time !== undefined && departure_time !== null) {
      if (typeof departure_time !== 'string' || !parseDate(departure_time)) {
        return NextResponse.json({ error: 'Invalid departure_time format' }, { status: 400 })
      }
    }

    const handoff = await prisma!.handoff.update({
      where: { id },
      data: {
        ...(sitter_name !== undefined && { sitter_name: sitter_name.trim() }),
        ...(sitter_phone !== undefined && { sitter_phone: sitter_phone?.trim() || null }),
        ...(arrival_time !== undefined && { arrival_time: parseDate(arrival_time) }),
        ...(departure_time !== undefined && { departure_time: parseDate(departure_time) }),
        ...(kids_bedtimes !== undefined && { kids_bedtimes: kids_bedtimes?.trim() || null }),
        ...(where_snacks !== undefined && { where_snacks: where_snacks?.trim() || null }),
        ...(pickup_authorized !== undefined && { pickup_authorized: pickup_authorized?.trim() || null }),
        ...(code_words !== undefined && { code_words: code_words?.trim() || null }),
        ...(pet_care !== undefined && { pet_care: pet_care?.trim() || null }),
        ...(emergency_notes !== undefined && { emergency_notes: emergency_notes?.trim() || null }),
        ...(house_notes !== undefined && { house_notes: house_notes?.trim() || null }),
        ...(general_notes !== undefined && { general_notes: general_notes?.trim() || null }),
      },
    })

    return NextResponse.json({ handoff })
  } catch (err) {
    console.error('PATCH /api/handoff/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/handoff/[id] - Delete a handoff (parent only, family-scoped)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params

    const existing = await prisma!.handoff.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const matchError = requireFamilyMatch(existing.family_id, auth.user.family_id)
    if (matchError) return matchError

    await prisma!.handoff.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/handoff/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
