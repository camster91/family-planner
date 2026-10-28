import { storageBackend } from '@/lib/storage-backend'
import { readD1FeedToken, ensureD1FeedToken } from '@/lib/cloudflare/family-preferences'
import { D1FamilySettingsError } from '@/lib/cloudflare/family-settings'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// GET /api/family/feed-token — return the current feed URL (parents only)
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error

  const parentError = requireParent(auth.user.role)
  if (parentError) return parentError

  if (storageBackend() === 'd1') {
    try { return NextResponse.json(await readD1FeedToken({ userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 })) }
    catch (err) { if (err instanceof D1FamilySettingsError) return NextResponse.json({ error: err.code }, { status: err.status }); throw err }
  }

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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const regenerate = body?.regenerate === true

    if (storageBackend() === 'd1') return NextResponse.json(await ensureD1FeedToken({ userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }, regenerate))

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
    if (error instanceof D1FamilySettingsError) return NextResponse.json({ error: error.code }, { status: error.status })
    logRouteError('POST /api/family/feed-token', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
