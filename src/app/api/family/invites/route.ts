import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { createEmailInviteSchema } from '@/lib/validations'
import {
  createInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  normalizeEmail,
} from '@/lib/family-invite'
import { familyInviteEmail } from '@/lib/mail'
import { sendAccountMail } from '@/lib/notification-delivery'
import { auditSummary, writeAuditLog } from '@/lib/household-audit'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error
  const parentError = requireParent(auth.user.role)
  if (parentError) return parentError

  const invites = await prisma!.familyInvite.findMany({
    where: {
      family_id: auth.user.family_id,
      accepted_at: null,
      expires_at: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      role: true,
      expires_at: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({ invites })
}

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const ip = getClientIp(request)
    const familyLimit = await checkRateLimit(`invite:${auth.user.family_id}`, 20, 60 * 60 * 1000)
    const ipLimit = await checkRateLimit(`invite-ip:${ip}`, 30, 60 * 60 * 1000)
    if (!familyLimit.allowed || !ipLimit.allowed) {
      return NextResponse.json({ error: 'Too many invites. Try again later.' }, { status: 429 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = createEmailInviteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const email = normalizeEmail(parsed.data.email)
    if (!email) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    const existingMember = await prisma!.user.findFirst({
      where: { email, family_id: auth.user.family_id },
      select: { id: true },
    })
    if (existingMember) {
      return NextResponse.json({ error: 'That person is already in your family' }, { status: 400 })
    }

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: { name: true },
    })
    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    const token = createInviteToken()
    const token_hash = hashInviteToken(token)
    const expires_at = new Date(Date.now() + INVITE_TTL_MS)

    const inviteId = await prisma!.$transaction(async (tx) => {
      // A new invite replaces any pending one to the same address. Each one
      // whose link still worked is recorded as cancelled (#285 review); an
      // expired one had already stopped working and is just cleared.
      const superseded = await tx.familyInvite.findMany({
        where: { family_id: auth.user.family_id, email, accepted_at: null, expires_at: { gt: new Date() } },
        select: { id: true, role: true },
      })
      for (const old of superseded) {
        const { count } = await tx.familyInvite.deleteMany({ where: { id: old.id, accepted_at: null } })
        if (count !== 1) continue
        await writeAuditLog(tx, {
          familyId: auth.user.family_id,
          actorUserId: auth.user.id,
          actorKind: 'person',
          action: 'invite.revoked',
          targetType: 'invite',
          targetId: old.id,
          summary: auditSummary.inviteRevoked(old.role),
        })
      }
      await tx.familyInvite.deleteMany({
        where: {
          family_id: auth.user.family_id,
          email,
          accepted_at: null,
        },
      })
      const invite = await tx.familyInvite.create({
        data: {
          family_id: auth.user.family_id,
          email,
          role: parsed.data.role,
          token_hash,
          expires_at,
          created_by: auth.user.id,
        },
        select: { id: true },
      })
      // Household audit history (#285): the role only, never the email address.
      await writeAuditLog(tx, {
        familyId: auth.user.family_id,
        actorUserId: auth.user.id,
        actorKind: 'person',
        action: 'invite.created',
        targetType: 'invite',
        targetId: invite.id,
        summary: auditSummary.inviteCreated(parsed.data.role),
      })
      return invite.id
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
    const joinUrl = `${appUrl.replace(/\/$/, '')}/join?token=${token}`
    const mail = familyInviteEmail({
      familyName: family.name,
      inviterName: auth.user.name,
      role: parsed.data.role,
      joinUrl,
    })
    await sendAccountMail('family_invite', { to: email, ...mail }).catch(async (mailErr) => {
      // The invite row is useless without its emailed join token — don't leave
      // a pending invite whose link was never delivered, nor its history row.
      await prisma!
        .$transaction([
          prisma!.familyInvite.deleteMany({ where: { token_hash } }),
          prisma!.auditLog.deleteMany({
            where: { family_id: auth.user.family_id, action: 'invite.created', target_id: inviteId },
          }),
        ])
        .catch(() => undefined)
      throw mailErr
    })

    return NextResponse.json({
      success: true,
      invite: { email, role: parsed.data.role, expires_at: expires_at.toISOString() },
    })
  } catch (error) {
    logRouteError('POST /api/family/invites', error, getRequestId(request))
    const message = error instanceof Error ? error.message : ''
    if (message.includes('MAILGUN_API_KEY')) {
      return NextResponse.json(
        // Shown to the parent: no server variable names. The operator sees
        // the cause in the route error log.
        { error: 'Email invites are not available right now. Share the family code or link below instead.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
  }
}
