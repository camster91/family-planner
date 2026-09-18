import { NextRequest, NextResponse } from 'next/server'
import { signToken, verifyToken, TokenPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Attach a session cookie carrying the user's current session generation.
 * `token_version` is read here rather than passed in so callers cannot forget it.
 */
export async function attachSessionCookie(
  response: NextResponse,
  payload: TokenPayload
): Promise<void> {
  const tv = (await getTokenVersion(payload.userId)) ?? 0
  response.cookies.set('session_token', signToken({ ...payload, tv }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

/**
 * Read the user's current session generation. Returns null when the user does
 * not exist (deleted account — their tokens must not authenticate).
 */
async function getTokenVersion(userId: string): Promise<number | null> {
  if (!prisma) return null
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { token_version: true },
  })
  return user ? user.token_version : null
}

/**
 * Authenticate a request and return the user's token payload.
 * Returns [payload, null] on success or [null, errorResponse] on failure.
 *
 * Beyond signature/expiry this enforces the session-generation check: a JWT is
 * only valid while its `tv` claim still matches `User.token_version`. A password
 * reset or change bumps that column, so previously issued cookies stop working
 * even though they remain cryptographically valid for their full 7 days.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<[TokenPayload, null] | [null, NextResponse]> {
  const unauthorized = () =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = request.cookies.get('session_token')?.value
  if (!token) {
    return [null, unauthorized()]
  }
  const payload = verifyToken(token)
  if (!payload) {
    return [null, unauthorized()]
  }

  const currentVersion = await getTokenVersion(payload.userId)
  if (currentVersion === null || currentVersion !== (payload.tv ?? 0)) {
    return [null, unauthorized()]
  }

  return [payload, null]
}

/**
 * Authenticate and also load the user with their family_id.
 * Returns [{ payload, user }, null] on success.
 */
export async function authenticateWithUser(
  request: NextRequest
): Promise<[{ payload: TokenPayload; user: { id: string; family_id: string | null; role: string; name: string; last_chore_date: Date | null } }, null] | [null, NextResponse]> {
  const [payload, error] = await authenticateRequest(request)
  if (error) return [null, error]

  const user = await prisma!.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, family_id: true, role: true, name: true, last_chore_date: true },
  })

  if (!user) {
    return [null, NextResponse.json({ error: 'User not found' }, { status: 404 })]
  }

  return [{ payload, user }, null]
}

/**
 * Authenticate and require the user to be in a family.
 */
export async function authenticateWithFamily(
  request: NextRequest
): Promise<[{ payload: TokenPayload; user: { id: string; family_id: string; role: string; name: string; last_chore_date: Date | null } }, null] | [null, NextResponse]> {
  const [result, error] = await authenticateWithUser(request)
  if (error) return [null, error]

  if (!result.user.family_id) {
    return [null, NextResponse.json({ error: 'You must belong to a family' }, { status: 400 })]
  }

  return [{ payload: result.payload, user: { ...result.user, family_id: result.user.family_id } }, null]
}

/**
 * Verify that a resource belongs to the user's family.
 */
export function requireFamilyMatch(resourceFamilyId: string, userFamilyId: string): NextResponse | null {
  if (resourceFamilyId !== userFamilyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/**
 * Require the user to be a parent.
 */
export function requireParent(role: string): NextResponse | null {
  if (role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can perform this action' }, { status: 403 })
  }
  return null
}
