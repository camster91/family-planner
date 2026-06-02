import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { registerSchema } from '@/lib/validations'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  try {
    // Rate limiting by IP
    const rateCheck = await checkRateLimit(`register:${ip}`, 20, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    const body = await request.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { email, password, name, role } = parsed.data

    const existing = await prisma!.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    const hashed = await hashPassword(password)

    // Build user.create data — include email_verified defensively.
    // If the column doesn't exist in the live DB (older deploy before
    // migration), retry without it. This makes the route forward-compatible
    // across rolling deploys.
    const createData: Record<string, unknown> = {
      email,
      password: hashed,
      name,
      role,
    }
    let user
    try {
      createData.email_verified = false
      user = await prisma!.user.create({ data: createData as any })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('email_verified') || msg.includes('does not exist')) {
        // Old deployment without the column — retry without it
        delete createData.email_verified
        user = await prisma!.user.create({ data: createData as any })
      } else {
        throw e
      }
    }

    // Send verification email (best-effort; never block registration on it)
    try {
      const { createVerificationToken } = await import('@/lib/tokens')
      const verifyToken = await createVerificationToken(user.id)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'
      const verifyUrl = appUrl + '/api/auth/verify-email?token=' + verifyToken

      const matonKey = process.env.MATON_API_KEY || process.env.MATON_API_KEY_ASHBI
      if (matonKey) {
        try {
          const html = [
            '<h2>Verify Your Email</h2>',
            `<p>Hi ${name},</p>`,
            '<p>Welcome to Family Planner! Please verify your email address to get started.</p>',
            `<p><a href="${verifyUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email</a></p>`,
            `<p>Or copy this link: ${verifyUrl}</p>`,
            '<p>This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>',
          ].join('\n')
          const mime = [
            `From: Family Planner <${process.env.FROM_EMAIL || 'noreply@family.ashbi.ca'}>`,
            `To: ${email}`,
            'Subject: Verify Your Family Planner Email',
            'Content-Type: text/html; charset=utf-8',
            '',
            html,
          ].join('\n')
          const mimeBody = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
          await fetch('https://api.maton.ai/google-mail/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${matonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: mimeBody }),
          })
        } catch (e) {
          console.warn('Verification email failed:', e)
        }
      } else {
        console.log(`[DEV] Verify URL for ${email}: ${verifyUrl}`)
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
