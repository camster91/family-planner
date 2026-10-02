import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { normalizeInviteCode } from '@/lib/family-invite'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// Brute-force math for these limits: createFamilyInviteCode in
// src/lib/family-invite.ts. The join page looks a code up once or twice per
// person, far below both.
const LOOKUP_PER_ACCOUNT_PER_HOUR = 30
const LOOKUP_PER_IP_PER_HOUR = 60
const LOOKUP_WINDOW_MS = 60 * 60 * 1000

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildLookupRateLimitKey(userId: string): string {
  // Account-wide bucket: keyed on the authenticated user only, so rotating
  // proxies or a spoofable X-Forwarded-For cannot reset the quota.
  return `family-lookup:${sha256(userId)}`
}

function buildLookupIpRateLimitKey(ip: string): string {
  // Per-IP bucket across accounts, so many accounts on one address share one quota.
  return `family-lookup-ip:${sha256(ip)}`
}

export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    // Both quotas are checked before the code is read or looked up.
    const buckets: Array<[key: string, max: number]> = [
      [buildLookupRateLimitKey(payload.userId), LOOKUP_PER_ACCOUNT_PER_HOUR],
      [buildLookupIpRateLimitKey(getClientIp(request)), LOOKUP_PER_IP_PER_HOUR],
    ]
    for (const [key, max] of buckets) {
      const rateCheck = await checkRateLimit(key, max, LOOKUP_WINDOW_MS)
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
    logRouteError('GET /api/family/lookup', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
