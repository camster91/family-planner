import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, signToken, checkRateLimit } from '@/lib/auth'
import { registerSchema } from '@/lib/validations'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateCheck = checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000) // 5 per hour
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
        // family_id is null until they create/join a family
      },
    })

    const token = signToken({ userId: user.id, email: user.email })

    const { password: _, ...userWithoutPassword } = user

    const response = NextResponse.json({ user: userWithoutPassword })
    response.cookies.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
