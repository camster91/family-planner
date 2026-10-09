import { withRouteTelemetry } from '@/lib/route-telemetry'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadTodayBoard } from '@/app/dashboard/today/board-snapshot'
import { deviceClock, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'
import { getRequestId } from '@/lib/request-id'
import { topUpHouseholdSeries } from '@/lib/recurringChores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/device/today: the Today board DTO with the device audience
 * (SHARED_DEVICE.md §9.1), including the calm-display settings and change
 * version (#271) but never photos. With GET /api/device/today/version and
 * /api/device/me this is the entire non-elevated read surface.
 */
export const GET = withRouteTelemetry('/api/device/today', handleGET)

async function handleGET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const now = deviceClock.now()
    // Recurring series are extended on read (no scheduler), so a tablet that
    // is the household's only screen still gets each new week's chores.
    // Bounded, idempotent, household-scoped, never throws. The version routes
    // do not do this; they only hash what is there.
    await topUpHouseholdSeries(auth.actor.familyId, now)
    // Weather (#262): the household's opt-in tile, or null. Never fails the board.
    const data = await loadTodayBoard(prisma!, {
      familyId: auth.actor.familyId,
      audience: 'device',
      now,
      withWeather: true,
    })
    return deviceJson(data)
  } catch (error) {
    return deviceInternalError('device.today', error, getRequestId(request))
  }
}
