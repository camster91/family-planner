import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { normaliseLabel } from '@/lib/device-pairing'
import { DEVICE_LIST_SELECT, devicesWithLiveSession, serializeDevice } from '@/lib/device-admin'
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
import { auditSummary, writeAuditLog } from '@/lib/household-audit'
import { getRequestId } from '@/lib/request-id'

/** PATCH /api/family/devices/:id { label } — rename a household tablet (parent only). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params
    const { familyId, userId } = manager

    const body = (await readJson(request)) as { label?: unknown } | undefined
    const label = normaliseLabel(body?.label)
    if (!label) return deviceError(400, 'VALIDATION_ERROR', { message: 'Label must be 1 to 40 characters.' })

    const limit = await checkRateLimit(`device-revoke:${userId}`, 30, 60 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    // Foreign and missing ids are the same 404.
    const existing = await prisma!.householdDevice.findFirst({
      where: { id, family_id: familyId },
      select: { id: true, label: true, revoked_at: true },
    })
    if (!existing) return deviceError(404, 'NOT_FOUND')
    if (existing.revoked_at) {
      return deviceError(400, 'VALIDATION_ERROR', { message: 'A removed tablet cannot be renamed.' })
    }

    // The rename and its household audit row (#285) commit together; nothing
    // is recorded when the label did not change or the tablet was removed meanwhile.
    // The label is re-read under a row lock so concurrent renames serialise
    // and each audit row names the label it actually replaced.
    await prisma!.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "HouseholdDevice"
        WHERE "id" = ${id} AND "family_id" = ${familyId}
        FOR UPDATE`
      const locked = await tx.householdDevice.findFirst({
        where: { id, family_id: familyId },
        select: { label: true },
      })
      const { count } = await tx.householdDevice.updateMany({
        where: { id, family_id: familyId, revoked_at: null },
        data: { label },
      })
      if (count !== 1 || !locked || locked.label === label) return
      await writeAuditLog(tx, {
        familyId,
        actorUserId: userId,
        actorKind: 'person',
        action: 'device.renamed',
        targetType: 'device',
        targetId: id,
        summary: auditSummary.deviceRenamed(locked.label, label),
      })
    })
    await writeDeviceAudit(prisma!, {
      familyId,
      deviceId: id,
      actorUserId: userId,
      type: 'device.renamed',
      metadata: {},
    })

    const now = deviceClock.now()
    const row = await prisma!.householdDevice.findFirst({ where: { id, family_id: familyId }, select: DEVICE_LIST_SELECT })
    const live = await devicesWithLiveSession(prisma!, familyId, [id], now)
    return deviceJson({ device: row ? serializeDevice(row, live.has(id)) : null })
  } catch (error) {
    return deviceInternalError('family_devices.rename', error, getRequestId(request))
  }
}
