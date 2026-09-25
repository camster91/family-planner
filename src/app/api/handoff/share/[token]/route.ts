import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'

export const dynamic = 'force-dynamic'

// GET /api/handoff/share/[token] - Public share view (no auth, no CSRF)
// Returns handoff by share_token if not expired; 404 if not found or expired.
// Only the fields the babysitter page (src/app/handoff/[token]) renders are
// returned — no family_id, created_by, share token or timestamps.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    // Unauthenticated endpoint keyed by a bearer token: throttle per IP so
    // tokens cannot be brute-forced.
    const ip = getClientIp(request)
    const rateCheck = await checkRateLimit(`handoff-share:${ip}`, 60, 15 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    const { token } = await params

    const handoff = await prisma!.handoff.findUnique({
      where: { share_token: token },
      select: {
        id: true,
        sitter_name: true,
        sitter_phone: true,
        arrival_time: true,
        departure_time: true,
        kids_bedtimes: true,
        where_snacks: true,
        pickup_authorized: true,
        code_words: true,
        pet_care: true,
        emergency_notes: true,
        house_notes: true,
        general_notes: true,
        share_expires_at: true,
        family: { select: { name: true } },
      },
    })

    if (!handoff) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Fail closed: a link with no expiry (legacy rows) is treated as expired.
    if (!handoff.share_expires_at || handoff.share_expires_at <= new Date()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const publicHandoff: Partial<typeof handoff> = { ...handoff }
    delete publicHandoff.share_expires_at
    return NextResponse.json({ handoff: publicHandoff })
  } catch (err) {
    console.error('GET /api/handoff/share/[token] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
