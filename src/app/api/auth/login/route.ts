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

    // Explicit select — never widen this to a whole-row fetch. Returning the row
    // and stripping `password` leaked any live reset_token / verify_token to the
    // browser, and would leak the session generation too.
    const user = await prisma!.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        age: true,
        family_id: true,
        avatar_url: true,
        email_verified: true,
        xp: true,
        level: true,
        streak: true,
        best_streak: true,
        last_chore_date: true,
        created_at: true,
        password: true,
        token_version: true,
      },
    })

    // Always run bcrypt to prevent timing-based email enumeration
    const valid = await safeVerifyPassword(password, user?.password ?? null)

    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Email verification gate — accounts must be confirmed before login.
    if (user.email_verified === false) {
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
      tv: user.token_version,
    })

    const { password: _pw, token_version: _tv, ...safeUser } = user

    const response = NextResponse.json({ user: safeUser })
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
