import type { Metadata } from 'next'
import { after } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { refreshStaleSubscriptions } from '@/lib/calendar-import/sync'
import { deviceClock, isSharedDeviceEnabled } from '@/lib/device-http'
import { DEVICE_ACCESS_COOKIE, readDeviceCookies, resolveDeviceAccess } from '@/lib/device-session'
import DeviceTodayScreen from '@/components/device/DeviceTodayScreen'
import { DeviceUnavailable } from '@/components/device/StatusScreens'

export const metadata: Metadata = { title: 'Today' }
export const dynamic = 'force-dynamic'

/**
 * Paired tablet home (#241). The board data is fetched by the client from
 * GET /api/device/today, so this page's HTML and RSC payload carry no
 * household data at all, only whether the access cookie is present (the
 * cold-launch bootstrap, SHARED_DEVICE.md §4).
 */
export default async function DeviceTodayPage() {
  if (!isSharedDeviceEnabled()) return <DeviceUnavailable />

  const cookieStore = await cookies()
  const hasAccessCookie = Boolean(cookieStore.get(DEVICE_ACCESS_COOKIE)?.value)

  // Subscribed calendars are refreshed by viewing, as on the person Today
  // page (§18); GET /api/device/today does not do it. Best effort, no cron.
  if (hasAccessCookie) {
    try {
      const resolved = await resolveDeviceAccess(prisma!, readDeviceCookies({ cookies: cookieStore }), deviceClock.now())
      if (resolved.ok) {
        const familyId = resolved.actor.familyId
        after(() => refreshStaleSubscriptions(familyId))
      }
    } catch (error) {
      log.warn('device.today_subscription_refresh_skipped', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return <DeviceTodayScreen hasAccessCookie={hasAccessCookie} />
}
