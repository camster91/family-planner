import { storageBackend } from '@/lib/storage-backend'
import { getD1Database } from '@/lib/cloudflare/database'
import { findD1AuthMeUser } from '@/lib/cloudflare/accounts'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-refusal'
import { isGamificationOn, omitUserGamification } from '@/lib/gamification-visibility'
import { normalizeFeatures } from '@/lib/features'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    // Full session validation, including the session-generation check — a
    // cookie revoked by a password reset must not still read the profile.
    const [payload, authError] = await authenticateRequest(request)
    if (authError) {
      return NextResponse.json({ user: null, error: 'Unauthorized' }, { status: 401 })
    }

    const select = {
      id: true,
      email: true,
      name: true,
      role: true,
      age: true,
      family_id: true,
      avatar_url: true,
      created_at: true,
      xp: true,
      level: true,
      streak: true,
      best_streak: true,
      last_chore_date: true,
      family: {
        select: { id: true, name: true, subscription_tier: true },
      },
      } as const
    const native = storageBackend() === 'd1'
    const nativeResult = native
      ? await findD1AuthMeUser(await getD1Database(), payload.userId, payload.tv ?? 0)
      : null
    const user = native
      ? nativeResult?.user ?? null
      : await prisma!.user.findUnique({ where: { id: payload.userId }, select })

    if (!user) {
      return NextResponse.json({ user: null, error: 'Unauthorized' }, { status: 401 })
    }

    // Points & streaks off for this family (#248): no XP/level/streak values.
    const gamificationOn = native
      ? normalizeFeatures(nativeResult?.familyFeatures ?? null).gamification
      : await isGamificationOn(user.family_id)
    if (!gamificationOn) {
      return NextResponse.json({ user: omitUserGamification(user) })
    }

    return NextResponse.json({ user })
  } catch (error) {
    logRouteError('GET /api/auth/me', error, getRequestId(request))
    return NextResponse.json({ user: null, error: 'Internal server error' }, { status: 500 })
  }
}
