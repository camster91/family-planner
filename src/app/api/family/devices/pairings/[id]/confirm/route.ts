import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { confirmPairing } from '@/lib/device-pairing'
import { deviceClock, deviceError, deviceInternalError, deviceJson, killSwitch, readJson } from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

/**
 * POST /api/family/devices/pairings/:id/confirm { digits } — the parent types
 * the 4 digits shown on the tablet (O-6). The third wrong attempt cancels the
 * pairing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params

    const body = (await readJson(request)) as { digits?: unknown } | undefined
    const digits = body?.digits
    if (typeof digits !== 'string' || !/^\d{4}$/.test(digits)) {
      return deviceError(400, 'VALIDATION_ERROR', { message: 'Enter the 4 digits shown on the tablet.' })
    }

    const result = await confirmPairing(prisma!, {
      pairingId: id,
      familyId: manager.familyId,
      userId: manager.userId,
      digits,
      now: deviceClock.now(),
    })
    switch (result.kind) {
      case 'not_found':
        return deviceError(404, 'NOT_FOUND')
      case 'confirmed':
        if (result.newly) {
          await writeDeviceAudit(prisma!, {
            familyId: manager.familyId,
            actorUserId: manager.userId,
            type: 'device.pairing_confirmed',
            metadata: { pairingId: id },
          })
        }
        return deviceJson({ status: 'confirmed' })
      case 'cancelled':
        return deviceError(410, 'PAIRING_CANCELLED')
      case 'expired':
        return deviceError(410, 'PAIRING_EXPIRED')
      case 'not_claimed':
        return deviceError(409, 'PAIRING_NOT_CLAIMED')
      case 'mismatch':
        if (result.cancelledNow) {
          await writeDeviceAudit(prisma!, {
            familyId: manager.familyId,
            actorUserId: manager.userId,
            type: 'device.pairing_cancelled',
            metadata: { pairingId: id, reason: 'digits_mismatch' },
          })
        }
        return deviceError(400, 'PAIRING_DIGITS_MISMATCH', { extra: { attemptsLeft: result.attemptsLeft } })
    }
  } catch (error) {
    return deviceInternalError('family_devices.pairing_confirm', error)
  }
}
