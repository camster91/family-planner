import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET /api/family/feed-token — return the current feed URL (parents only)
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error

  const parentError = requireParent(auth.user.role)
  if (parentError) return parentError

  const family = await prisma!.family.findUnique({
    where: { id: auth.user.family_id },
    select: { feed_token: true },
  })

  return NextResponse.json({ feedToken: family?.feed_token ?? null })
}

// POST /api/family/feed-token — create the token, or regenerate it (parents only)
// Regenerating invalidates the old link, which is how you revoke access.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json().catch(() => ({}))
    const regenerate = body?.regenerate === true

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: { feed_token: true },
    })

    if (family?.feed_token && !regenerate) {
      return NextResponse.json({ feedToken: family.feed_token })
    }

    const token = randomBytes(24).toString('hex')

    await prisma!.family.update({
      where: { id: auth.user.family_id },
      data: { feed_token: token },
    })

    return NextResponse.json({ feedToken: token, regenerated: Boolean(family?.feed_token) })
  } catch (error) {
    console.error('Feed token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
