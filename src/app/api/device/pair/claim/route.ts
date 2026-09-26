import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { log } from '@/lib/logger'
import { writeDeviceAudit } from '@/lib/device-audit'
import { claimPairing } from '@/lib/device-pairing'
import {
  deviceClock,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'

/** Coarse, non-reversible source label for alert logs; never the raw IP. */
function ipBucket(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 8)
}

/**
 * POST /api/device/pair/claim { code, platform, appVersion } — public (no
 * session), CSRF-protected. Unknown, expired, used and cancelled codes all get
 * the identical 400 PAIRING_CODE_INVALID body. Anything else the tablet sends
 * (a family id, a member id) is ignored: the household comes from the code.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const ip = getClientIp(request)
    const limit = await checkRateLimit(`device-pair-claim:${ip}`, 10, 15 * 60 * 1000)
    if (!limit.allowed) {
      log.warn('device.pair_claim_throttled', { ipBucket: ipBucket(ip) })
      return rateLimited(limit)
    }

    const body = (await readJson(request)) as { code?: unknown; platform?: unknown; appVersion?: unknown } | undefined
    const platform = body?.platform
    if (platform !== 'android' && platform !== 'web') {
      return deviceError(400, 'VALIDATION_ERROR', { message: "platform must be 'android' or 'web'." })
    }
    const appVersion = typeof body?.appVersion === 'string' && body.appVersion.trim() ? body.appVersion.trim().slice(0, 32) : null

    const now = deviceClock.now()
    const result = await claimPairing(prisma!, { code: body?.code, platform, appVersion, now })
    if (!result.ok) {
      // System-wide failure counter: an alert, not a block.
      const failures = await checkRateLimit('device-pair-claim-fail:global', 500, 60 * 60 * 1000)
      if (failures.remaining === 0) log.warn('device.pair_claim_failures_high', { windowMinutes: 60 })
      return deviceError(400, 'PAIRING_CODE_INVALID')
    }

    await writeDeviceAudit(prisma!, {
      familyId: result.familyId,
      type: 'device.pairing_claimed',
      metadata: { pairingId: result.pairingId, platform, appVersion },
    })
    return deviceJson({
      claimToken: result.claimToken,
      confirmDigits: result.confirmDigits,
      expiresAt: result.expiresAt.toISOString(),
    })
  } catch (error) {
    return deviceInternalError('device.pair_claim', error)
  }
}
