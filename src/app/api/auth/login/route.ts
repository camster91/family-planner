import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeVerifyPassword, signToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { loginSchema } from '@/lib/validations'
import { log } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  try {
    // Rate limiting by IP (Postgres-backed, works across replicas)
    const rateCheck = await checkRateLimit(`login:${ip}`, 30, 15 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    const body = await request.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { email, password } = parsed.data

    const user = await prisma!.user.findUnique({ where: { email } })

    // Always run bcrypt to prevent timing-based email enumeration
    const valid = await safeVerifyPassword(password, user?.password ?? null)

    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Email verification gate — accounts must be confirmed before login.
    // Defensive: if the email_verified column doesn't exist (older deploy),
    // skip the check rather than 500. Login still works in that case.
    if ('email_verified' in user && user.email_verified === false) {
      return NextResponse.json(
        { error: 'Please verify your email before signing in. Check your inbox for the verification link.' },
        { status: 403 }
      )
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      family_id: user.family_id,
    })

    const { password: _, ...userWithoutPassword } = user

    const response = NextResponse.json({ user: userWithoutPassword })
    response.cookies.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch (error) {
    log.error('auth.login', error instanceof Error ? error : new Error(String(error)), { ip })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
