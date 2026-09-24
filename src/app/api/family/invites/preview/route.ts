import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { hashInviteToken, normalizeInviteToken } from '@/lib/family-invite'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rateCheck = await checkRateLimit(`invite-preview:${ip}`, 30, 60 * 60 * 1000)
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const token = normalizeInviteToken(request.nextUrl.searchParams.get('token'))
  if (!token) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  const invite = await prisma!.familyInvite.findUnique({
    where: { token_hash: hashInviteToken(token) },
    select: {
      email: true,
      role: true,
      expires_at: true,
      accepted_at: true,
      family: { select: { name: true } },
    },
  })

  if (!invite || invite.accepted_at || invite.expires_at < new Date()) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  return NextResponse.json({
    familyName: invite.family.name,
    role: invite.role,
    email: invite.email,
  })
}
