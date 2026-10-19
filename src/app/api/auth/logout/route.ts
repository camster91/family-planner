import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySessionToken } from '@/lib/session'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import type { QueueRetirement } from '@/lib/queue-owner-contract'

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
  let retirement: QueueRetirement | null = null
  const token = request.cookies.get('session_token')?.value
  if (token) {
    try {
      // Only a still-current token may bump the generation, so replaying an
      // old revoked cookie cannot sign the user out of their newer sessions.
      const payload = await verifySessionToken(token)
      if (payload) {
        const generation = payload.tv ?? 0
        const revoked = await prisma!.user.updateMany({
          where: { id: payload.userId, token_version: generation },
          data: { token_version: { increment: 1 } },
        })
        // The atomic generation comparison also closes verify-then-update
        // races. A stale logout must not revoke a newer session generation.
        if (revoked.count === 1) retirement = { mode: 'generation', ownerId: payload.userId, throughGeneration: generation }
      }
    } catch (error) {
      logRouteError('POST /api/auth/logout', error, getRequestId(request))
    }
  }

  const response = NextResponse.json({ success: true, ...(retirement ? { retirement } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } })
  response.cookies.set('session_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
