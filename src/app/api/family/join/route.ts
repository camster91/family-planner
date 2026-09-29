import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, attachSessionCookie } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { joinFamilySchema } from '@/lib/validations'
import {
  hashInviteToken,
  normalizeEmail,
  normalizeInviteCode,
  normalizeInviteToken,
} from '@/lib/family-invite'
import { lockHouseholdForJoin } from '@/lib/household-lock'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const ip = getClientIp(request)
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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = joinFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'inviteCode or token is required' }, { status: 400 })
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

    const token = normalizeInviteToken(parsed.data.token)
    if (token) {
      return acceptEmailInvite(payload.userId, user?.email ?? '', token)
    }

    const inviteCode = normalizeInviteCode(parsed.data.inviteCode)
    if (!inviteCode) {
      return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 })
    }

    const family = await prisma!.family.findUnique({
      where: { invite_code: inviteCode },
      select: { id: true, name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    const joinRole = user?.role === 'teen' ? 'teen' : 'child'
    return finishJoin(payload.userId, family.id, family.name, joinRole)
  } catch (error) {
    console.error('Error joining family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function acceptEmailInvite(userId: string, userEmail: string, token: string) {
  const invite = await prisma!.familyInvite.findUnique({
    where: { token_hash: hashInviteToken(token) },
    include: { family: { select: { id: true, name: true } } },
  })

  if (!invite || invite.accepted_at || invite.expires_at < new Date()) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 })
  }

  if (normalizeEmail(userEmail) !== invite.email) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email address' },
      { status: 403 }
    )
  }

  return finishJoin(userId, invite.family.id, invite.family.name, invite.role, invite.id)
}

/**
 * Add the member in one transaction under the household membership lock
 * (src/lib/household-lock.ts), so a join cannot interleave with a household
 * deletion: it either finishes before the deletion starts, or waits and finds
 * the household gone (404). An email invite is consumed in the same
 * transaction, so a refused join leaves it unused.
 */
async function finishJoin(userId: string, familyId: string, familyName: string, role: string, inviteId?: string) {
  const outcome = await prisma!.$transaction(async (tx) => {
    if (!(await lockHouseholdForJoin(tx, familyId))) return { error: 'Family not found' as const }
    const current = await tx.user.findUnique({ where: { id: userId }, select: { family_id: true } })
    if (!current) return { error: 'User not found' as const }
    if (current.family_id) return { error: 'already' as const }
    if (inviteId) {
      const accepted = await tx.familyInvite.updateMany({
        where: { id: inviteId, family_id: familyId, accepted_at: null, expires_at: { gt: new Date() } },
        data: { accepted_at: new Date() },
      })
      if (accepted.count === 0) return { error: 'Invite not found or expired' as const }
    }
    const user = await tx.user.update({
      where: { id: userId },
      data: { family_id: familyId, role },
      select: { id: true, email: true, role: true, family_id: true },
    })
    return { user }
  })
  if ('error' in outcome) {
    if (outcome.error === 'already') {
      return NextResponse.json(
        { error: 'You already belong to a family. Leave your current family first.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: outcome.error }, { status: 404 })
  }
  const updated = outcome.user

  const response = NextResponse.json({ success: true, familyName })
  await attachSessionCookie(response, {
    userId: updated.id,
    email: updated.email,
    role: updated.role,
    family_id: updated.family_id,
  })
  return response
}
