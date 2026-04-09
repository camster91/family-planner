import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, TokenPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Authenticate a request and return the user's token payload.
 * Returns [payload, null] on success or [null, errorResponse] on failure.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<[TokenPayload, null] | [null, NextResponse]> {
  const token = request.cookies.get('session_token')?.value
  if (!token) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })]
  }
  const payload = verifyToken(token)
  if (!payload) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })]
  }
  return [payload, null]
}

/**
 * Authenticate and also load the user with their family_id.
 * Returns [{ payload, user }, null] on success.
 */
export async function authenticateWithUser(
  request: NextRequest
): Promise<[{ payload: TokenPayload; user: { id: string; family_id: string | null; role: string; name: string; points: number; xp: number; level: number; streak: number; best_streak: number; last_chore_date: Date | null } }, null] | [null, NextResponse]> {
  const [payload, error] = await authenticateRequest(request)
  if (error) return [null, error]

  const user = await prisma!.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, family_id: true, role: true, name: true, points: true, xp: true, level: true, streak: true, best_streak: true, last_chore_date: true },
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
): Promise<[{ payload: TokenPayload; user: { id: string; family_id: string; role: string; name: string; points: number; xp: number; level: number; streak: number; best_streak: number; last_chore_date: Date | null } }, null] | [null, NextResponse]> {
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
