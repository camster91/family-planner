import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySessionToken } from '@/lib/session'

/**
 * Sign out. Besides clearing the cookie, bump `User.token_version` so the JWT
 * that was just in the cookie stops authenticating even if a copy of it
 * survives (every auth path checks the generation, see src/lib/session.ts).
 *
 * This revokes every session of the user issued before now, not only this
 * browser's. A missing, expired or already-revoked cookie is not an error:
 * there is nothing to revoke, so the cookie is cleared and 200 returned.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get('session_token')?.value
  if (token) {
    try {
      // Only a still-current token may bump the generation, so replaying an
      // old revoked cookie cannot sign the user out of their newer sessions.
      const payload = await verifySessionToken(token)
      if (payload) {
        await prisma!.user.update({
          where: { id: payload.userId },
          data: { token_version: { increment: 1 } },
        })
      }
    } catch (error) {
      console.error('Error revoking session on logout:', error)
    }
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set('session_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
