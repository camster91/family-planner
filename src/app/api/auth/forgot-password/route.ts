import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/auth'
import { createResetToken, cleanupExpiredTokens } from '@/lib/password-reset'

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateCheck = checkRateLimit(`forgot:${ip}`, 3, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const { email } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({ where: { email: email.toLowerCase() } })

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ message: 'If an account exists with that email, a reset link has been sent.' })
    }

    const token = createResetToken(user.id)
    cleanupExpiredTokens()

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://family.ashbi.ca'}/reset-password?token=${token}`

    // TODO: Send email with reset link via email service
    console.log(`Password reset for ${email}. Reset URL: ${resetUrl}`)

    return NextResponse.json({
      message: 'If an account exists with that email, a reset link has been sent.',
      // Include token in dev for testing without email
      ...(process.env.NODE_ENV !== 'production' && { resetToken: token }),
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}