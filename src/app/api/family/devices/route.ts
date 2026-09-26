import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { AUDIT_RETENTION_MS } from '@/lib/device-audit'
import { PAIRING_RETENTION_MS } from '@/lib/device-pairing'
import { DEVICE_LIST_SELECT, REMOVED_DEVICE_VISIBLE_MS, devicesWithLiveSession, serializeDevice } from '@/lib/device-admin'
import { deviceClock, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

/**
 * GET /api/family/devices — the household's shared tablets (parent only).
 * Opening the list also prunes this household's old pairings and audit rows
 * (SHARED_DEVICE.md §3 notes); there is no scheduled job.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { familyId } = manager
    const now = deviceClock.now()

    try {
      await prisma!.devicePairing.deleteMany({
        where: { family_id: familyId, expires_at: { lt: new Date(now.getTime() - PAIRING_RETENTION_MS) } },
      })
      await prisma!.deviceAuditEvent.deleteMany({
        where: { family_id: familyId, created_at: { lt: new Date(now.getTime() - AUDIT_RETENTION_MS) } },
      })
    } catch (error) {
      log.warn('device.prune_failed', { message: error instanceof Error ? error.message : String(error) })
    }

    const rows = await prisma!.householdDevice.findMany({
      where: {
        family_id: familyId,
        OR: [{ revoked_at: null }, { revoked_at: { gt: new Date(now.getTime() - REMOVED_DEVICE_VISIBLE_MS) } }],
      },
      select: DEVICE_LIST_SELECT,
      orderBy: [{ paired_at: 'desc' }, { id: 'asc' }],
    })
    const live = await devicesWithLiveSession(
      prisma!,
      familyId,
      rows.map((r) => r.id),
      now
    )
    return deviceJson({ devices: rows.map((r) => serializeDevice(r, live.has(r.id))) })
  } catch (error) {
    return deviceInternalError('family_devices.list', error)
  }
}
