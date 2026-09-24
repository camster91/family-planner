import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { createEmailInviteSchema } from '@/lib/validations'
import {
  createInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  normalizeEmail,
} from '@/lib/family-invite'
import { familyInviteEmail, sendMail } from '@/lib/mail'

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

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
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

    await prisma!.$transaction(async (tx) => {
      await tx.familyInvite.deleteMany({
        where: {
          family_id: auth.user.family_id,
          email,
          accepted_at: null,
        },
      })
      await tx.familyInvite.create({
        data: {
          family_id: auth.user.family_id,
          email,
          role: parsed.data.role,
          token_hash,
          expires_at,
          created_by: auth.user.id,
        },
      })
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
    const joinUrl = `${appUrl.replace(/\/$/, '')}/join?token=${token}`
    const mail = familyInviteEmail({
      familyName: family.name,
      inviterName: auth.user.name,
      role: parsed.data.role,
      joinUrl,
    })
    await sendMail({ to: email, ...mail }).catch(async (mailErr) => {
      // The invite row is useless without its emailed join token — don't leave
      // a pending invite whose link was never delivered.
      await prisma!.familyInvite.deleteMany({ where: { token_hash } }).catch(() => undefined)
      throw mailErr
    })

    return NextResponse.json({
      success: true,
      invite: { email, role: parsed.data.role, expires_at: expires_at.toISOString() },
    })
  } catch (error) {
    console.error('Error sending family invite:', error)
    const message = error instanceof Error ? error.message : ''
    if (message.includes('MAILGUN_API_KEY')) {
      return NextResponse.json(
        { error: 'Email is not configured. Set MAILGUN_API_KEY on the server.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
  }
}
