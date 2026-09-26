import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth'
import { checkRateLimit, isRateLimited, resetRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { isValidPinFormat } from '@/lib/elevation-pin'
import {
  deviceClock,
  deviceEmpty,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'
import {
  clearDeviceCookies,
  DEVICE_ELEVATION_HEADER,
  ELEVATION_IDLE_MS,
  elevationHeaderMatches,
  endElevation,
  startElevation,
} from '@/lib/device-session'

const MIN = 60 * 1000
// SHARED_DEVICE.md §11. All failure-only: checked before, counted on failure.
const DEVICE_USER_LIMIT = 5
const DEVICE_LIMIT = 10
const ACCOUNT_LIMIT = 10
const LOGIN_ACCOUNT_LIMIT = 10 // shared with POST /api/auth/login
const LOCK_MS = 60 * MIN

// A well-formed cost-12 bcrypt hash of a random, discarded secret. Compared
// against when there is no PIN/password to check, so every attempt costs one
// full bcrypt round. (`safeVerifyPassword`'s dummy is not a valid 60-char hash,
// so bcryptjs rejects it in ~1 ms; see the #240 report.)
const ELEVATION_DUMMY_HASH = '$2b$12$W4bM51anF3VllFWGRQ81XeuX31LTRKNd1f/8kw73F6uc.ypIOe9LO'

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  method: z.enum(['pin', 'password']),
  secret: z.string().min(1).max(200),
})

/**
 * POST /api/device/elevation (SHARED_DEVICE.md §6.2). A parent of the
 * device's household proves identity with their tablet PIN or account
 * password. Unknown, foreign, non-parent and wrong-secret attempts all return
 * the same 401 after a bcrypt compare.
 *
 * Account-scoped counters (`device-elev-fail-acct:`, `login-fail:`) and the PIN
 * lock only move for a real parent of THIS household, so a tablet cannot lock
 * out a parent of another household by guessing with their id.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const { deviceId, familyId } = auth.actor
    const now = deviceClock.now()

    const parsed = bodySchema.safeParse(await readJson(request))
    if (!parsed.success) return deviceError(400, 'VALIDATION_ERROR')
    const { userId, method, secret } = parsed.data

    const deviceUserKey = `device-elev-fail:${deviceId}:${userId}`
    const deviceKey = `device-elev-fail:${deviceId}`
    for (const [key, max] of [
      [deviceUserKey, DEVICE_USER_LIMIT],
      [deviceKey, DEVICE_LIMIT],
    ] as const) {
      const check = await isRateLimited(key, max)
      if (!check.allowed) return rateLimited(check)
    }

    const user = await prisma!.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, family_id: true, token_version: true, password: true },
    })
    const target = user && user.family_id === familyId && user.role === 'parent' ? user : null
    const accountKey = target ? `device-elev-fail-acct:${target.id}` : null
    const loginKey = target ? `login-fail:${target.email.toLowerCase()}` : null

    let secretHash: string | null = null
    if (target && method === 'pin') {
      let pin = await prisma!.parentElevationPin.findUnique({
        where: { user_id: target.id },
        select: { family_id: true, pin_hash: true, locked_until: true },
      })
      // A PIN set in another household gives no power here (§3 notes).
      if (pin && pin.family_id !== target.family_id) {
        await prisma!.parentElevationPin.deleteMany({ where: { user_id: target.id } })
        pin = null
      }
      if (pin?.locked_until && pin.locked_until.getTime() > now.getTime()) {
        return deviceError(423, 'ELEVATION_LOCKED', {
          headers: { 'Retry-After': String(Math.ceil((pin.locked_until.getTime() - now.getTime()) / 1000)) },
        })
      }
      const accountCheck = await isRateLimited(accountKey!, ACCOUNT_LIMIT)
      if (!accountCheck.allowed) {
        return deviceError(423, 'ELEVATION_LOCKED', {
          headers: { 'Retry-After': String(Math.max(1, Math.ceil(accountCheck.retryAfterMs / 1000))) },
        })
      }
      secretHash = pin?.pin_hash ?? null
    }
    if (target && method === 'password') {
      // Password fallback shares the login account lockout.
      const loginCheck = await isRateLimited(loginKey!, LOGIN_ACCOUNT_LIMIT)
      if (!loginCheck.allowed) return rateLimited(loginCheck)
      secretHash = target.password ?? null
    }

    // Always one bcrypt compare (dummy hash when there is nothing to compare).
    const wellFormed = method === 'password' || isValidPinFormat(secret)
    const matched = await verifyPassword(secret, secretHash ?? ELEVATION_DUMMY_HASH)
    const valid = Boolean(target && secretHash && wellFormed && matched)

    if (!valid || !target) {
      const deviceUser = await checkRateLimit(deviceUserKey, DEVICE_USER_LIMIT, 15 * MIN)
      await checkRateLimit(deviceKey, DEVICE_LIMIT, 15 * MIN)
      if (target) {
        const account = await checkRateLimit(accountKey!, ACCOUNT_LIMIT, 60 * MIN)
        if (method === 'password') await checkRateLimit(loginKey!, LOGIN_ACCOUNT_LIMIT, 15 * MIN)
        if (account.remaining === 0) {
          await prisma!.parentElevationPin.updateMany({
            where: { user_id: target.id },
            data: { locked_until: new Date(now.getTime() + LOCK_MS) },
          })
          await writeDeviceAudit(prisma!, {
            familyId,
            deviceId,
            actorUserId: target.id,
            type: 'device.elevation_locked',
            metadata: { scope: 'account' },
          })
        } else if (deviceUser.remaining === 0) {
          await writeDeviceAudit(prisma!, {
            familyId,
            deviceId,
            actorUserId: target.id,
            type: 'device.elevation_locked',
            metadata: { scope: 'device' },
          })
        }
      }
      return deviceError(401, 'ELEVATION_INVALID_CREDENTIAL')
    }

    await resetRateLimit(deviceUserKey)
    const started = await startElevation(prisma!, {
      deviceId,
      parentId: target.id,
      tokenVersion: target.token_version,
      method,
      now,
    })
    if (!started) {
      const res = deviceError(401, 'DEVICE_REVOKED')
      clearDeviceCookies(res)
      return res
    }

    await writeDeviceAudit(prisma!, {
      familyId,
      deviceId,
      actorUserId: target.id,
      type: 'device.elevation_started',
      metadata: { method },
    })
    return deviceJson({
      elevationToken: started.token,
      expiresAt: started.expiresAt.toISOString(),
      idleTimeoutSeconds: ELEVATION_IDLE_MS / 1000,
      member: { id: target.id, name: target.name },
    })
  } catch (error) {
    return deviceInternalError('device.elevation_start', error)
  }
}

/** DELETE /api/device/elevation: end this device's elevation. Idempotent 204. */
export async function DELETE(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    if (elevationHeaderMatches(auth.device, request.headers.get(DEVICE_ELEVATION_HEADER))) {
      await endElevation(prisma!, auth.device, 'exit')
    }
    return deviceEmpty(204)
  } catch (error) {
    return deviceInternalError('device.elevation_end', error)
  }
}
