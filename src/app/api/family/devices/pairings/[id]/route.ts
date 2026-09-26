import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { cancelPairing, PARENT_PAIRING_SELECT, parentPairingStatus } from '@/lib/device-pairing'
import {
  deviceClock,
  deviceEmpty,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
} from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

/**
 * GET /api/family/devices/pairings/:id — the parent's dialog polls this. Never
 * returns the code or the confirmation digits. `replaces` is null unless the
 * pairing replaces a tablet, then `{ deviceId, removed }`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params

    const limit = await checkRateLimit(`device-pair-poll:${manager.userId}`, 300, 10 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    const row = await prisma!.devicePairing.findFirst({
      where: { id, family_id: manager.familyId },
      select: PARENT_PAIRING_SELECT,
    })
    if (!row) return deviceError(404, 'NOT_FOUND')

    const status = parentPairingStatus(row, deviceClock.now())
    // "Replace": report the old tablet's state from the database, so the
    // dialog says it was removed only when it really was (§7).
    let replaces: { deviceId: string; removed: boolean } | null = null
    if (row.replaces_device_id) {
      const old = await prisma!.householdDevice.findFirst({
        where: { id: row.replaces_device_id, family_id: manager.familyId },
        select: { revoked_at: true },
      })
      replaces = { deviceId: row.replaces_device_id, removed: Boolean(old?.revoked_at) }
    }
    return deviceJson({
      status,
      ...(row.claimed_at ? { claim: { platform: row.claim_platform, appVersion: row.claim_app_version } } : {}),
      replaces,
    })
  } catch (error) {
    return deviceInternalError('family_devices.pairing_get', error)
  }
}

/** DELETE /api/family/devices/pairings/:id — cancel ("This isn't my tablet"). Idempotent 204. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params

    const result = await cancelPairing(prisma!, { pairingId: id, familyId: manager.familyId, now: deviceClock.now() })
    if (!result.found) return deviceError(404, 'NOT_FOUND')
    if (result.cancelledNow) {
      await writeDeviceAudit(prisma!, {
        familyId: manager.familyId,
        actorUserId: manager.userId,
        type: 'device.pairing_cancelled',
        metadata: { pairingId: id, reason: 'parent' },
      })
    }
    return deviceEmpty(204)
  } catch (error) {
    return deviceInternalError('family_devices.pairing_cancel', error)
  }
}
