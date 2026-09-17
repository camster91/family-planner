import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, attachSessionCookie } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { joinFamilySchema } from '@/lib/validations'
import { normalizeInviteCode } from '@/lib/family-invite'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = await checkRateLimit(`join:${payload.userId}:${ip}`, 10, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many join attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000) || 60),
          },
        }
      )
    }

    const body = await request.json()
    const parsed = joinFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'inviteCode is required' },
        { status: 400 }
      )
    }

    const inviteCode = normalizeInviteCode(parsed.data.inviteCode)
    if (!inviteCode) {
      return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { family_id: true, role: true, email: true },
    })

    if (user?.family_id) {
      return NextResponse.json(
        { error: 'You already belong to a family. Leave your current family first.' },
        { status: 400 }
      )
    }

    const family = await prisma!.family.findUnique({
      where: { invite_code: inviteCode },
      select: { id: true, name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    const joinRole = user?.role === 'teen' ? 'teen' : 'child'

    const updated = await prisma!.user.update({
      where: { id: payload.userId },
      data: { family_id: family.id, role: joinRole },
      select: { id: true, email: true, role: true, family_id: true },
    })

    const response = NextResponse.json({ success: true, familyName: family.name })
    attachSessionCookie(response, {
      userId: updated.id,
      email: updated.email,
      role: updated.role,
      family_id: updated.family_id,
    })
    return response
  } catch (error) {
    console.error('Error joining family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
