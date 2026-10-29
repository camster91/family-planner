import { storageBackend } from '@/lib/storage-backend'
import { D1NotificationPreferenceError, readD1NotificationPreferences, updateD1NotificationPreferences } from '@/lib/cloudflare/notification-preferences'
import { notificationPreferencesBody as body, notificationPreferencesColumns } from '@/lib/notification-preferences-values'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithUser } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey, withIdempotency, idempotencyError, type EffectResult } from '@/lib/idempotency'
import {
  MORNING_SUMMARY_SELECT,
  NOTIFICATION_PREFERENCES_ACTION,
  NOTIFICATION_PREFERENCE_SELECT,
} from '@/lib/notification-policy'
import { isClockTime } from '@/lib/ambient'
import {
  MAX_TIME_ZONE_LENGTH,
  QUIET_HOURS_SELECT,
  isValidTimeZone,
} from '@/lib/quiet-hours'
import { apiError, logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { withRouteTelemetry } from '@/lib/route-telemetry'

export const dynamic = 'force-dynamic'

const clockTime = z.string().refine(isClockTime, { message: 'Use a 24-hour time like 22:00' })

// Quiet hours (#141, O-32): the whole setting at once. Times are "HH:MM" and
// may wrap past midnight; they must differ. `timeZone` is the browser's IANA
// zone (null or missing = UTC).
const quietHoursSchema = z
  .object({
    enabled: z.boolean(),
    start: clockTime,
    end: clockTime,
    timeZone: z
      .string()
      .max(MAX_TIME_ZONE_LENGTH)
      .refine(isValidTimeZone, { message: 'Unknown time zone' })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((q) => q.start !== q.end, { message: 'Quiet hours need different start and end times' })

// Morning summary (O-40): opt-in switch plus the browser's IANA zone, which
// decides the person's "today" and event times (null or missing = none saved).
const morningSummarySchema = z
  .object({
    enabled: z.boolean(),
    timeZone: z
      .string()
      .max(MAX_TIME_ZONE_LENGTH)
      .refine(isValidTimeZone, { message: 'Unknown time zone' })
      .nullable()
      .optional(),
  })
  .strict()

// Strict: an unknown key (including any attempt to name another member, e.g.
// `userId`) is a 400. At least one setting must be present.
const patchSchema = z
  .object({
    chores: z.boolean().optional(),
    events: z.boolean().optional(),
    messages: z.boolean().optional(),
    quietHours: quietHoursSchema.optional(),
    morningSummary: morningSummarySchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.chores !== undefined ||
      v.events !== undefined ||
      v.messages !== undefined ||
      v.quietHours !== undefined ||
      v.morningSummary !== undefined,
    { message: 'Send at least one of chores, events, messages, quietHours or morningSummary' }
  )

const SELECT = { ...NOTIFICATION_PREFERENCE_SELECT, ...QUIET_HOURS_SELECT, ...MORNING_SUMMARY_SELECT } as const

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// This route was already on the nested API_CONTRACTS.md shape; #161 adds
// `requestId` inside it: `{ error: { code, message, requestId } }`.
function error(status: number, code: string, message: string, requestId: string): NextResponse {
  return apiError(status, code, message, { requestId, shape: 'nested', headers: NO_STORE })
}

// GET /api/users/preferences — the caller's own notification preferences
// (#286, PR101 D-5), quiet hours (#141, O-32) and morning summary (O-40). Any role; there is no way to
// name another member.
async function getPreferences(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, authError] = await authenticateWithUser(request)
    if (authError) return authError

    if (storageBackend() === 'd1') return NextResponse.json(await readD1NotificationPreferences({ userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }), { headers: NO_STORE })

    const row = await prisma!.user.findUnique({
      where: { id: auth.user.id },
      select: SELECT,
    })
    return NextResponse.json(body(row), { headers: NO_STORE })
  } catch (err) {
    if (err instanceof D1NotificationPreferenceError) return error(err.code === 'UNAUTHORIZED' ? 401 : 403, err.code, 'Access changed. Sign in again.', requestId)
    logRouteError('GET /api/users/preferences', err, requestId)
    return error(500, 'INTERNAL_ERROR', 'Internal server error', requestId)
  }
}

export const GET = withRouteTelemetry('/api/users/preferences', getPreferences)

// PATCH /api/users/preferences { chores?, events?, messages?, quietHours?, morningSummary? } —
// change the caller's own switches and quiet hours. Any role. Optional `Idempotency-Key`: the update sets
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

    let input: unknown
    try {
      input = await request.json()
    } catch {
      return error(400, 'INVALID_JSON', 'Invalid JSON', requestId)
    }
    const parsed = patchSchema.safeParse(input)
    if (!parsed.success) return error(400, 'VALIDATION_ERROR', parsed.error.issues[0].message, requestId)

    if (storageBackend() === 'd1') {
      const result = await updateD1NotificationPreferences({ userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }, parsed.data, key)
      return NextResponse.json(result.body, { headers: { ...NO_STORE, ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}) } })
    }
    const userId = auth.user.id
    const effect = async (): Promise<EffectResult> => {
      const row = await prisma!.user.update({
        where: { id: userId },
        data: notificationPreferencesColumns(parsed.data),
        select: SELECT,
      })
      return { status: 200, body: body(row) }
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
    if (err instanceof D1NotificationPreferenceError) {
      if (err.code === 'IDEMPOTENCY_KEY_REUSED' || err.code === 'IDEMPOTENCY_IN_PROGRESS') return idempotencyError(err.code)
      return error(err.code === 'UNAUTHORIZED' ? 401 : 403, err.code, 'Access changed. Sign in again.', requestId)
    }
    logRouteError('PATCH /api/users/preferences', err, requestId)
    return error(500, 'INTERNAL_ERROR', 'Internal server error', requestId)
  }
}

export const PATCH = withRouteTelemetry('/api/users/preferences', patchPreferences)
