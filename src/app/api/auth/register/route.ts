import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { hashPassword } from '@/lib/auth'
import { attachSessionCookie } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { registerSchema } from '@/lib/validations'
import { hashInviteToken, normalizeEmail, normalizeInviteToken } from '@/lib/family-invite'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Rate limit BEFORE any DB lookup — prevents email enumeration attacks
  const rateCheck = await checkRateLimit(`register:${ip}`, 20, 60 * 60 * 1000)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    )
  }

  try {
    const body = await request.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const email = normalizeEmail(parsed.data.email) ?? parsed.data.email.trim().toLowerCase()
    const { password, name } = parsed.data
    const inviteToken = normalizeInviteToken(parsed.data.inviteToken)

    let invite: { id: string; family_id: string; role: string; email: string; family: { name: string } } | null = null
    if (inviteToken) {
      const found = await prisma!.familyInvite.findUnique({
        where: { token_hash: hashInviteToken(inviteToken) },
        select: {
          id: true,
          family_id: true,
          role: true,
          email: true,
          expires_at: true,
          accepted_at: true,
          family: { select: { name: true } },
        },
      })
      if (!found || found.accepted_at || found.expires_at < new Date()) {
        return NextResponse.json({ error: 'Invite not found or expired' }, { status: 400 })
      }
      if (found.email !== email) {
        return NextResponse.json(
          { error: 'This invite was sent to a different email address' },
          { status: 403 }
        )
      }
      invite = found
    }

    const existing = await prisma!.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    const hashed = await hashPassword(password)

    const createData: Record<string, unknown> = {
      email,
      password: hashed,
      name,
      role: invite?.role ?? 'parent',
    }
    if (invite) {
      createData.family_id = invite.family_id
    }
    let user
    try {
      createData.email_verified = Boolean(invite)
      user = await prisma!.user.create({ data: createData as any })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('email_verified') || msg.includes('does not exist')) {
        delete createData.email_verified
        user = await prisma!.user.create({ data: createData as any })
      } else {
        throw e
      }
    }

    if (invite) {
      const consumed = await prisma!.familyInvite.updateMany({
        where: { id: invite.id, accepted_at: null, expires_at: { gt: new Date() } },
        data: { accepted_at: new Date() },
      })
      if (consumed.count === 0) {
        await prisma!.user.delete({ where: { id: user.id } }).catch(() => undefined)
        return NextResponse.json({ error: 'Invite not found or expired' }, { status: 400 })
      }

      const { password: _pw, reset_token, verify_token, token_version, ...safeUser } = user as typeof user & {
        reset_token?: string | null
        verify_token?: string | null
        token_version?: number
      }
      const response = NextResponse.json({
        user: safeUser,
        joinedFamily: true,
        familyName: invite.family.name,
        requiresVerification: false,
      })
      await attachSessionCookie(response, {
        userId: user.id,
        email: user.email,
        role: user.role,
        family_id: user.family_id,
      })
      return response
    }

    // Send verification email (best-effort; never block registration on it)
    try {
      const { createVerificationToken } = await import('@/lib/tokens')
      const verifyToken = await createVerificationToken(user.id)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
      const verifyUrl = appUrl + '/api/auth/verify-email?token=' + verifyToken

      const html = [
        '<h2>Verify Your Email</h2>',
        `<p>Hi ${name},</p>`,
        '<p>Welcome to Family Planner! Please verify your email address to get started.</p>',
        `<p><a href="${verifyUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email</a></p>`,
        `<p>Or copy this link: ${verifyUrl}</p>`,
        '<p>This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>',
      ].join('\n')

      try {
        await sendMail({
          to: email,
          subject: 'Verify Your Family Planner Email',
          html,
          text: `Verify your Family Planner email: ${verifyUrl} - this link expires in 24 hours.`,
        })
      } catch (e) {
        // Registration must not fail if email delivery fails; surface it in logs.
        console.warn('Verification email failed:', e)
      }
    } catch (e) {
      // Token creation failed (e.g. old deploy without verify_token column)
      // Log but don't fail registration — the user can request a new verify
      // email later via /api/auth/resend-verification (TODO: implement)
      console.warn('Verification token creation failed:', e)
    }

    // NOTE: We deliberately do NOT issue a session token here. The user must
    // verify their email first, then log in. See /api/auth/login for the
    // verification gate.

    // Same column allowlist as the invite path — never echo internal auth
    // columns (reset_token, verify_token, token_version) to the client.
    const { password: _pw, reset_token, verify_token, token_version, ...safeUser } = user as typeof user & {
      reset_token?: string | null
      verify_token?: string | null
      token_version?: number
    }
    const response = NextResponse.json({
      user: safeUser,
      requiresVerification: true,
    })
    return response
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
