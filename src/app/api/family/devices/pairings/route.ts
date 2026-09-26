import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { createPairing, formatPairingCode, normaliseLabel } from '@/lib/device-pairing'
import {
  deviceClock,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

/**
 * POST /api/family/devices/pairings { label } — a parent creates a single-use,
 * 10-minute pairing code for a new tablet (SHARED_DEVICE.md §5). The code is
 * returned once and stored only as a hash.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { familyId, userId } = manager

    const body = (await readJson(request)) as { label?: unknown } | undefined
    const label = normaliseLabel(body?.label)
    if (!label) return deviceError(400, 'VALIDATION_ERROR', { message: 'Label must be 1 to 40 characters.' })

    const perParent = await checkRateLimit(`device-pair-create:${userId}`, 5, 60 * 60 * 1000)
    if (!perParent.allowed) return rateLimited(perParent)
    const perFamily = await checkRateLimit(`device-pair-create-fam:${familyId}`, 10, 60 * 60 * 1000)
    if (!perFamily.allowed) return rateLimited(perFamily)

    const result = await createPairing(prisma!, { familyId, userId, label, now: deviceClock.now() })
    if (!result.ok) return deviceError(409, 'DEVICE_LIMIT_REACHED')

    for (const pairingId of result.superseded) {
      await writeDeviceAudit(prisma!, {
        familyId,
        actorUserId: userId,
        type: 'device.pairing_cancelled',
        metadata: { pairingId, reason: 'superseded' },
      })
    }
    await writeDeviceAudit(prisma!, {
      familyId,
      actorUserId: userId,
      type: 'device.pairing_created',
      metadata: { pairingId: result.pairingId },
    })

    return deviceJson(
      { pairingId: result.pairingId, code: formatPairingCode(result.code), expiresAt: result.expiresAt.toISOString() },
      201
    )
  } catch (error) {
    return deviceInternalError('family_devices.pairing_create', error)
  }
}
