import { NextRequest, NextResponse } from 'next/server'
import { hashPassword } from '@/lib/auth'
import { consumeResetToken, resetTokenExists } from '@/lib/tokens'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 })
    }

    // Reject tokens that match nothing BEFORE paying for bcrypt. `hashPassword`
    // is cost-12, so hashing first let anyone burn ~250ms of CPU per request on
    // this public, unauthenticated endpoint by posting garbage. The claim below
    // is still the authority; this only avoids the wasted work.
    if (!(await resetTokenExists(token))) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(password)

    // Single atomic claim: matches the token hash, checks expiry, clears the
    // token, writes the new password and bumps token_version in one UPDATE.
    // Concurrent submissions of the same link therefore cannot both succeed.
    const consumed = await consumeResetToken(token, hashedPassword)
    if (!consumed) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    // The password changed, so drop the session cookie too. token_version has
    // already invalidated any other outstanding JWT server-side.
    const response = NextResponse.json({ message: 'Password has been reset successfully' })
    response.cookies.set('session_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })

    return response
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
