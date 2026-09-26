import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { normaliseLabel } from '@/lib/device-pairing'
import { deviceError, deviceInternalError, deviceJson, killSwitch, rateLimited, readJson } from '@/lib/device-http'
import { authenticateDevice, requireElevation } from '@/lib/device-route'
import { clearDeviceCookies } from '@/lib/device-session'

/** PATCH /api/device/label { label }: an elevated parent renames THIS tablet. */
export async function PATCH(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const elevated = await requireElevation(request, auth)
    if (!elevated.ok) return elevated.response
    const { actor } = elevated

    const body = (await readJson(request)) as { label?: unknown } | undefined
    const label = normaliseLabel(body?.label)
    if (!label) return deviceError(400, 'VALIDATION_ERROR', { message: 'Label must be 1 to 40 characters.' })

    const limit = await checkRateLimit(`device-revoke:${actor.parentId}`, 30, 60 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    const { count } = await prisma!.householdDevice.updateMany({
      where: { id: actor.deviceId, family_id: actor.familyId, revoked_at: null },
      data: { label },
    })
    if (count !== 1) {
      const res = deviceError(401, 'DEVICE_REVOKED')
      clearDeviceCookies(res)
      return res
    }

    await writeDeviceAudit(prisma!, {
      familyId: actor.familyId,
      deviceId: actor.deviceId,
      actorUserId: actor.parentId,
      type: 'device.elevated_action',
      metadata: { action: 'rename_device', targetType: 'device', targetId: actor.deviceId },
    })
    return deviceJson({ device: { id: actor.deviceId, label } })
  } catch (error) {
    return deviceInternalError('device.label', error)
  }
}
