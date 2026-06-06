import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// POST /api/handoff/[id]/regenerate-token - Generate new share token (parent only)
export async function POST(
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

    // Generate new token:32 hex chars (16 bytes)
    const newToken = randomBytes(16).toString('hex')
    // Expire in 6 hours
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000)

    const handoff = await prisma!.handoff.update({
      where: { id },
      data: {
        share_token: newToken,
        share_expires_at: expiresAt,
      },
    })

    return NextResponse.json({ handoff })
  } catch (err) {
    console.error('POST /api/handoff/[id]/regenerate-token error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
