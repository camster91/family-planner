import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceInternalError, deviceJson, killSwitch, rateLimited } from '@/lib/device-http'
import { authenticateDevice, requireElevation } from '@/lib/device-route'
import { clearDeviceCookies, revokeDevice } from '@/lib/device-session'
import { auditSummary, writeAuditLog } from '@/lib/household-audit'

/**
 * POST /api/device/revoke-self: an elevated parent removes THIS tablet
 * (SHARED_DEVICE.md §6.4, §8). Cookies are cleared in the response.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const elevated = await requireElevation(request, auth)
    if (!elevated.ok) return elevated.response
    const { actor } = elevated

    const limit = await checkRateLimit(`device-revoke:${actor.parentId}`, 30, 60 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    await writeDeviceAudit(prisma!, {
      familyId: actor.familyId,
      deviceId: actor.deviceId,
      actorUserId: actor.parentId,
      type: 'device.elevated_action',
      metadata: { action: 'revoke_device', targetType: 'device', targetId: actor.deviceId },
    })
    await revokeDevice(
      prisma!,
      {
        deviceId: actor.deviceId,
        familyId: actor.familyId,
        revokedBy: actor.parentId,
        reason: 'parent',
        now: deviceClock.now(),
      },
      // Household audit history (#285), in the revoke's transaction.
      async (tx) => {
        const row = await tx.householdDevice.findFirst({
          where: { id: actor.deviceId, family_id: actor.familyId },
          select: { label: true },
        })
        await writeAuditLog(tx, {
          familyId: actor.familyId,
          actorUserId: actor.parentId,
          actorKind: 'device',
          action: 'device.removed',
          targetType: 'device',
          targetId: actor.deviceId,
          summary: auditSummary.deviceRemoved(row?.label, 'parent'),
        })
      }
    )

    const res = deviceJson({ status: 'revoked' })
    clearDeviceCookies(res)
    return res
  } catch (error) {
    return deviceInternalError('device.revoke_self', error)
  }
}
