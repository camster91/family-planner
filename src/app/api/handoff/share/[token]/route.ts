import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/handoff/share/[token] - Public share view (no auth, no CSRF)
// Returns handoff by share_token if not expired;404 if not found or expired
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const handoff = await prisma!.handoff.findUnique({
      where: { share_token: token },
      include: {
        family: { select: { name: true } },
      },
    })

    if (!handoff) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Check expiry
    if (handoff.share_expires_at && handoff.share_expires_at < new Date()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ handoff })
  } catch (err) {
    console.error('GET /api/handoff/share/[token] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
