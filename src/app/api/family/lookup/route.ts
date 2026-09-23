import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { normalizeInviteCode } from '@/lib/family-invite'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = await checkRateLimit(
      `lookup:${payload.userId}:${ip}`,
      20,
      60 * 1000
    )
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many lookup attempts' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000) || 60),
          },
        }
      )
    }

    const code = normalizeInviteCode(request.nextUrl.searchParams.get('code'))
    if (!code) {
      return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 })
    }

    const family = await prisma!.family.findUnique({
      where: { invite_code: code },
      select: { name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({ family: { name: family.name } })
  } catch (error) {
    console.error('Error looking up family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
