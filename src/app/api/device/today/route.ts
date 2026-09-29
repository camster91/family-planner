import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadTodayBoard } from '@/app/dashboard/today/board-snapshot'
import { deviceClock, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

/**
 * GET /api/device/today: the Today board DTO with the device audience
 * (SHARED_DEVICE.md §9.1), including the calm-display settings and change
 * version (#271) but never photos. With GET /api/device/today/version and
 * /api/device/me this is the entire non-elevated read surface.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    // Weather (#262): the household's opt-in tile, or null. Never fails the board.
    const data = await loadTodayBoard(prisma!, {
      familyId: auth.actor.familyId,
      audience: 'device',
      now: deviceClock.now(),
      withWeather: true,
    })
    return deviceJson(data)
  } catch (error) {
    return deviceInternalError('device.today', error)
  }
}
