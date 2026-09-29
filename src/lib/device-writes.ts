/**
 * Shared-tablet writes (#274; SHARED_DEVICE.md §9.2, §12.3, ADR-0006).
 *
 * The only non-elevated writes a paired tablet may make are grocery
 * tick/untick, grocery quick add and chore complete (plus the tablet's own
 * short Undo of a chore it just completed). Every one of them passes this
 * gate, in this order:
 *
 * 1. the server kill switch (`SHARED_DEVICE_ENABLED`, checked by the route);
 * 2. a live device cookie (`authenticateDevice`);
 * 3. the household opt-in `Family.device_writes_enabled` (default off), then
 *    the domain feature (`lists` / `chores`);
 * 4. a per-tablet rate limit;
 * 5. an `Idempotency-Key` header (required here, unlike the person routes:
 *    every tablet client is new and queues its writes);
 * 6. `actingMemberId`, a member of the device's own household ("Who's this?",
 *    O-5). Unverified attribution only: it is written where a `User` FK is
 *    required and in the audit row, and never grants that member's
 *    capabilities. A foreign and an unknown id get the same 400.
 *
 * The effect then runs inside `withIdempotency` with the scope
 * `device:<deviceId>`, so a queued retry is replayed instead of applied twice
 * and a key is never shared between tablets or with a person.
 */
import type { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { idempotencyError, readIdempotencyKey, withIdempotency, type EffectResult } from '@/lib/idempotency'
import { NO_STORE, deviceError, rateLimited, readJson } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'
import type { DeviceActor } from '@/lib/device-session'

/** Tablet writes per device per hour: a busy kitchen, not a script. */
export const DEVICE_WRITE_LIMIT = 300
export const DEVICE_WRITE_WINDOW_MS = 60 * 60 * 1000

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface DeviceWriteContext {
  actor: DeviceActor
  key: string
  body: Record<string, unknown>
  member: { id: string; name: string }
}

type Fail = { ok: false; response: NextResponse }

export async function openDeviceWrite(
  request: NextRequest,
  feature: 'lists' | 'chores'
): Promise<{ ok: true; ctx: DeviceWriteContext } | Fail> {
  const auth = await authenticateDevice(request)
  if (!auth.ok) return auth
  const { actor } = auth

  const family = await prisma!.family.findUnique({
    where: { id: actor.familyId },
    select: { device_writes_enabled: true, features: true },
  })
  if (!family?.device_writes_enabled) return { ok: false, response: deviceError(403, 'DEVICE_WRITES_OFF') }
  if (!normalizeFeatures(family.features)[feature]) return { ok: false, response: deviceError(403, 'FEATURE_DISABLED') }

  const limit = await checkRateLimit(`device-write:${actor.deviceId}`, DEVICE_WRITE_LIMIT, DEVICE_WRITE_WINDOW_MS)
  if (!limit.allowed) return { ok: false, response: rateLimited(limit) }

  const { key, error: keyError } = readIdempotencyKey(request)
  if (keyError) return { ok: false, response: noStore(keyError) }
  if (!key) return { ok: false, response: noStore(idempotencyError('IDEMPOTENCY_KEY_REQUIRED')) }

  const raw = await readJson(request)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, response: deviceError(400, 'VALIDATION_ERROR') }
  }
  const body = raw as Record<string, unknown>
  const memberId = body.actingMemberId
  if (typeof memberId !== 'string' || !ID_PATTERN.test(memberId)) {
    return { ok: false, response: deviceError(400, 'ACTING_MEMBER_INVALID') }
  }
  const member = await prisma!.user.findFirst({
    where: { id: memberId, family_id: actor.familyId },
    select: { id: true, name: true },
  })
  if (!member) return { ok: false, response: deviceError(400, 'ACTING_MEMBER_INVALID') }

  return { ok: true, ctx: { actor, key, body, member } }
}

/**
 * Run a tablet write at most once per (device, key). `action` is the fixed
 * idempotency action name; `hashed` is the validated request (route id
 * included), which is hashed, never stored.
 */
export async function runDeviceWrite(
  ctx: DeviceWriteContext,
  action: string,
  hashed: Record<string, unknown>,
  effect: () => Promise<EffectResult>
): Promise<NextResponse> {
  const res = await withIdempotency(
    prisma!,
    ctx.key,
    { scope: `device:${ctx.actor.deviceId}`, familyId: ctx.actor.familyId, userId: null, action },
    hashed,
    effect
  )
  return noStore(res)
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', NO_STORE)
  return res
}

export function isRouteId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}
