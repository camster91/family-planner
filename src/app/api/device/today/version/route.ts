import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadTodayBoard } from '@/app/dashboard/today/board-snapshot'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { deviceClock, deviceInternalError, deviceJson, killSwitch, rateLimited } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/** Per tablet: about one check every 3 s, far above the board's 25 s poll. */
const DEVICE_BOARD_VERSION_LIMIT = 1200
const DEVICE_BOARD_VERSION_WINDOW_MS = 60 * 60 * 1000

/**
 * GET /api/device/today/version (#271): `{ version }` of the device-audience
 * board (GET /api/device/today), nothing else. Same auth and isolation as the
 * board: the device cookie only, the device's own household only, kill
 * switch 404. The tablet polls it and re-fetches the board when it changes.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response

    const limit = await checkRateLimit(
      `device-board-version:${auth.actor.deviceId}`,
      DEVICE_BOARD_VERSION_LIMIT,
      DEVICE_BOARD_VERSION_WINDOW_MS
    )
    if (!limit.allowed) return rateLimited(limit)

    const board = await loadTodayBoard(prisma!, {
      familyId: auth.actor.familyId,
      audience: 'device',
      now: deviceClock.now(),
    })
    return deviceJson({ version: board.version })
  } catch (error) {
    return deviceInternalError('device.today_version', error, getRequestId(request))
  }
}
