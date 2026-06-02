import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, signToken, checkRateLimit } from '@/lib/auth'
import { registerSchema } from '@/lib/validations'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = checkRateLimit(`register:${ip}`, 20, 60 * 60 * 1000) // 20 per hour
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

    const user = await prisma!.user.create({
      data: {
        email,
        password: hashed,
        name,
        role,
        // Email must be verified before login (see /api/auth/login)
        email_verified: false,
      },
    })

    // Send verification email
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

    // NOTE: We deliberately do NOT issue a session token here. The user must verify
    // their email first, then log in. See /api/auth/login for the verification gate.

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
