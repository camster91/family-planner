import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithUser } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey, withIdempotency, type EffectResult } from '@/lib/idempotency'
import {
  NOTIFICATION_PREFERENCES_ACTION,
  NOTIFICATION_PREFERENCE_SELECT,
  preferencesFromRow,
  preferencesToColumns,
} from '@/lib/notification-policy'
import { apiError, logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { withRouteTelemetry } from '@/lib/route-telemetry'

export const dynamic = 'force-dynamic'

// Strict: an unknown key (including any attempt to name another member, e.g.
// `userId`) is a 400. At least one switch must be present.
const patchSchema = z
  .object({
    chores: z.boolean().optional(),
    events: z.boolean().optional(),
    messages: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.chores !== undefined || v.events !== undefined || v.messages !== undefined, {
    message: 'Send at least one of chores, events or messages',
  })

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// This route was already on the nested API_CONTRACTS.md shape; #161 adds
// `requestId` inside it: `{ error: { code, message, requestId } }`.
function error(status: number, code: string, message: string, requestId: string): NextResponse {
  return apiError(status, code, message, { requestId, shape: 'nested', headers: NO_STORE })
}

// GET /api/users/preferences — the caller's own notification preferences
// (#286, PR101 D-5). Any role; there is no way to name another member.
async function getPreferences(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, authError] = await authenticateWithUser(request)
    if (authError) return authError

    const row = await prisma!.user.findUnique({
      where: { id: auth.user.id },
      select: NOTIFICATION_PREFERENCE_SELECT,
    })
    return NextResponse.json({ preferences: preferencesFromRow(row) }, { headers: NO_STORE })
  } catch (err) {
    logRouteError('GET /api/users/preferences', err, requestId)
    return error(500, 'INTERNAL_ERROR', 'Internal server error', requestId)
  }
}

export const GET = withRouteTelemetry('/api/users/preferences', getPreferences)

// PATCH /api/users/preferences { chores?, events?, messages? } — change the
// caller's own switches. Any role. Optional `Idempotency-Key`: the update sets
// explicit values, so a replay or a re-run converges. A member without a
// household has no idempotency scope (records belong to a household), so their
// key is ignored and the same explicit update simply runs again.
async function patchPreferences(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, authError] = await authenticateWithUser(request)
    if (authError) return authError

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error(400, 'INVALID_JSON', 'Invalid JSON', requestId)
    }
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return error(400, 'VALIDATION_ERROR', parsed.error.issues[0].message, requestId)

    const userId = auth.user.id
    const effect = async (): Promise<EffectResult> => {
      const row = await prisma!.user.update({
        where: { id: userId },
        data: preferencesToColumns(parsed.data),
        select: NOTIFICATION_PREFERENCE_SELECT,
      })
      return { status: 200, body: { preferences: preferencesFromRow(row) } }
    }

    const familyId = auth.user.family_id
    const res = familyId
      ? await withIdempotency(
          prisma!,
          key,
          { scope: `user:${userId}`, familyId, userId, action: NOTIFICATION_PREFERENCES_ACTION },
          parsed.data,
          effect
        )
      : await effect().then((r) => NextResponse.json(r.body, { status: r.status }))
    for (const [name, value] of Object.entries(NO_STORE)) res.headers.set(name, value)
    return res
  } catch (err) {
    logRouteError('PATCH /api/users/preferences', err, requestId)
    return error(500, 'INTERNAL_ERROR', 'Internal server error', requestId)
  }
}

export const PATCH = withRouteTelemetry('/api/users/preferences', patchPreferences)
