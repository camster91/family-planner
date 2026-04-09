import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeVerifyPassword, signToken, checkRateLimit } from '@/lib/auth'
import { loginSchema } from '@/lib/validations'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateCheck = checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)
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

    const token = signToken({ userId: user.id, email: user.email })

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
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
