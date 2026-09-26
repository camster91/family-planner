import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'
import { buildTodayBoard } from '@/app/dashboard/today/today-board-data'
import { deviceClock, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

/**
 * GET /api/device/today: the Today board DTO with the device audience
 * (SHARED_DEVICE.md §9.1). This is the entire non-elevated read surface.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const familyId = auth.actor.familyId

    const family = await prisma!.family.findUnique({ where: { id: familyId }, select: { features: true } })
    const data = await buildTodayBoard(prisma!, {
      familyId,
      audience: 'device',
      features: normalizeFeatures(family?.features),
      now: deviceClock.now(),
    })
    return deviceJson(data)
  } catch (error) {
    return deviceInternalError('device.today', error)
  }
}
