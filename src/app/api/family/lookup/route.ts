import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'

export const dynamic = 'force-dynamic'

const LOOKUP_MAX_ATTEMPTS = 20
const LOOKUP_WINDOW_MS = 60 * 1000

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

function buildLookupRateLimitKey(userId: string, clientIp: string): string {
  const fingerprint = createHash('sha256')
    .update(`${userId}\0${clientIp}`)
    .digest('hex')

  return `family-lookup:${fingerprint}`
}

export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    // Use both authenticated identity and client IP without storing either in plaintext.
    const rateCheck = await checkRateLimit(
      buildLookupRateLimitKey(payload.userId, getClientIp(request)),
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

    const code = request.nextUrl.searchParams.get('code')
    if (!code || code.length < 3) {
      return NextResponse.json({ error: 'Valid code is required' }, { status: 400 })
    }

    // Look up by invite code directly
    const family = await prisma!.family.findUnique({
      where: { invite_code: code },
      select: { id: true, name: true },
    })

    if (!family) {
      // Fallback: try the old FAM-{id} format
      const familyIdMatch = code.match(/FAM-([A-Z0-9]+)/i)
      if (familyIdMatch) {
        const partialId = familyIdMatch[1].toLowerCase()
        const familyById = await prisma!.family.findFirst({
          where: { id: { startsWith: partialId } },
          select: { id: true, name: true },
        })

        if (familyById) {
          return NextResponse.json({ family: familyById })
        }
      }

      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error looking up family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
