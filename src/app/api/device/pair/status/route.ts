import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { findPairingByClaimToken, issuePairedDevice } from '@/lib/device-pairing'
import {
  deviceClock,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'
import { clearPersonSessionCookie, setDeviceCookies } from '@/lib/device-session'

/**
 * POST /api/device/pair/status { claimToken } — the tablet polls until the
 * parent confirms. The first call after confirmation creates the device, sets
 * the device cookies and clears `session_token` on this browser (without
 * bumping the parent's token_version). Every later call gets 410.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const body = (await readJson(request)) as { claimToken?: unknown } | undefined
    const row = await findPairingByClaimToken(prisma!, body?.claimToken)
    if (!row) return deviceError(410, 'PAIRING_EXPIRED')

    const limit = await checkRateLimit(`device-pair-status:${row.id}`, 300, 10 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    const result = await issuePairedDevice(prisma!, row, deviceClock.now())
    switch (result.kind) {
      case 'pending':
        return deviceJson({ status: 'pending' })
      case 'expired':
        return deviceError(410, 'PAIRING_EXPIRED')
      case 'cancelled':
        return deviceError(410, 'PAIRING_CANCELLED')
      case 'limit':
        await writeDeviceAudit(prisma!, {
          familyId: row.family_id,
          type: 'device.pairing_cancelled',
          metadata: { pairingId: row.id, reason: 'device_limit' },
        })
        return deviceError(409, 'DEVICE_LIMIT_REACHED')
      case 'paired': {
        if (result.replacedDeviceId) {
          await writeDeviceAudit(prisma!, {
            familyId: row.family_id,
            deviceId: result.replacedDeviceId,
            actorUserId: row.confirmed_by,
            type: 'device.revoked',
            metadata: { reason: 'replaced' },
          })
        }
        await writeDeviceAudit(prisma!, {
          familyId: row.family_id,
          deviceId: result.device.id,
          actorUserId: row.confirmed_by,
          type: 'device.paired',
          metadata: { pairingId: row.id, platform: row.claim_platform === 'android' ? 'android' : 'web' },
        })
        const res = deviceJson({ status: 'paired', device: result.device })
        setDeviceCookies(res, result.tokens)
        clearPersonSessionCookie(res)
        return res
      }
    }
  } catch (error) {
    return deviceInternalError('device.pair_status', error)
  }
}
