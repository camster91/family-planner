import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { attachSessionCookie } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { registerSchema } from '@/lib/validations'
import { hashInviteToken, normalizeEmail, normalizeInviteToken } from '@/lib/family-invite'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Rate limit BEFORE any DB lookup â€” prevents email enumeration attacks
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
      const { sendVerificationEmail } = await import('@/lib/email')
      const verifyToken = await createVerificationToken(user.id)
      const result = await sendVerificationEmail(email, name, verifyToken)
      if (!result.ok) {
        // Surfaced, not swallowed: a broken mail path must be visible, or users
        // silently never receive a link and cannot verify.
        console.warn(`Verification email not delivered for ${email}: ${result.error}`)
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

    const { password: _, ...userWithoutPassword } = user
    const response = NextResponse.json({
      user: userWithoutPassword,
      requiresVerification: true,
    })
    return response
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
