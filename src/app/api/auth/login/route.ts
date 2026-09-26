import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeVerifyPassword, signToken } from '@/lib/auth'
import { checkRateLimit, isRateLimited, resetRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { loginSchema } from '@/lib/validations'
import { log } from '@/lib/logger'
import { deviceClock, deviceError, isSharedDeviceEnabled } from '@/lib/device-http'
import { hasLiveDeviceCredential, readDeviceCookies } from '@/lib/device-session'

// Failed attempts allowed per account per window, independent of source IP, so
// rotating addresses cannot brute-force one password.
const ACCOUNT_FAILURE_LIMIT = 10
const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  try {
    // Rate limiting by IP (Postgres-backed, works across replicas)
    const rateCheck = await checkRateLimit(`login:${ip}`, 30, 15 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    // Shared tablet (#157/#240, O-13): a parent must not leave a persisted
    // person session on a paired device. A valid access cookie, or a refresh
    // cookie of a live session (looked up, never rotated here), blocks login;
    // parents use elevation instead. Ignored while the kill switch is off.
    if (isSharedDeviceEnabled()) {
      const deviceCookies = readDeviceCookies(request)
      if (
        (deviceCookies.access || deviceCookies.refresh) &&
        (await hasLiveDeviceCredential(prisma!, deviceCookies, deviceClock.now()))
      ) {
        return deviceError(409, 'DEVICE_MODE_LOGIN_BLOCKED')
      }
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { email, password } = parsed.data

    const accountKey = `login-fail:${email.toLowerCase()}`
    const accountCheck = await isRateLimited(accountKey, ACCOUNT_FAILURE_LIMIT)
    if (!accountCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(accountCheck.retryAfterMs / 1000)) } }
      )
    }

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
      await checkRateLimit(accountKey, ACCOUNT_FAILURE_LIMIT, ACCOUNT_FAILURE_WINDOW_MS)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    await resetRateLimit(accountKey)

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
