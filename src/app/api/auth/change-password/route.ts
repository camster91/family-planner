import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, hashPassword } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, attachSessionCookie } from '@/lib/api-auth'
import { changePasswordSchema } from '@/lib/validations'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export async function POST(request: NextRequest) {
  try {
    const [payload, authError] = await authenticateRequest(request)
    if (authError) return authError

    // A stolen session cookie must not become an unlimited current-password
    // oracle. Counted per account, like login's per-account failure limit.
    const rateCheck = await checkRateLimit(`change-password:${payload.userId}`, 10, 15 * 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { currentPassword, newPassword } = parsed.data

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, password: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isValid = await verifyPassword(currentPassword, user.password || '')
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(newPassword)

    // Bumping token_version revokes every session issued before this change —
    // a stolen cookie stops working. The device making the change gets a fresh
    // cookie below so the user is not signed out of the session they just used.
    // Any outstanding reset link is cleared too: a link requested before the
    // change must not be able to override the new password.
    await prisma!.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        token_version: { increment: 1 },
        reset_token: null,
        reset_token_expires: null,
      },
    })

    const response = NextResponse.json({ message: 'Password changed successfully' })
    await attachSessionCookie(response, {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      family_id: payload.family_id,
    })

    return response
  } catch (error) {
    logRouteError('POST /api/auth/change-password', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
