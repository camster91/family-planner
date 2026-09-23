import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { normalizeInviteCode } from '@/lib/family-invite'

export const dynamic = 'force-dynamic'

const LOOKUP_MAX_ATTEMPTS = 20
const LOOKUP_WINDOW_MS = 60 * 1000

function buildLookupRateLimitKey(userId: string): string {
  // Account-wide bucket: keyed on the authenticated user only, so rotating
  // proxies or a spoofable X-Forwarded-For cannot reset the quota.
  const fingerprint = createHash('sha256').update(userId).digest('hex')

  return `family-lookup:${fingerprint}`
}

export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    // Account-wide quota — an authenticated enumerator cannot reset it by
    // varying their IP or X-Forwarded-For.
    const rateCheck = await checkRateLimit(
      buildLookupRateLimitKey(payload.userId),
      LOOKUP_MAX_ATTEMPTS,
      LOOKUP_WINDOW_MS
    )
    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateCheck.retryAfterMs / 1000))
      return NextResponse.json(
        { error: 'Too many lookup attempts' },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }
      )
    }

    const code = normalizeInviteCode(request.nextUrl.searchParams.get('code'))
    if (!code) {
      return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 })
    }

    const family = await prisma!.family.findUnique({
      where: { invite_code: code },
      select: { id: true, name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error looking up family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
