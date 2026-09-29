import type { Metadata } from 'next'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isParentRole } from '@/lib/role-capabilities'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { isCalendarSyncEnabled } from '@/lib/calendar-sync/config'
import SettingsClient from './SettingsClient'

export const metadata: Metadata = { title: 'Settings' }
// The shared-device kill switch is read per request.
export const dynamic = 'force-dynamic'

/**
 * Settings. The page itself is client-rendered (./SettingsClient.tsx); this
 * server wrapper only decides whether the shared-tablet entries (Devices,
 * Tablet PIN, #241) are shown: kill switch on AND a parent (role read from
 * the database), and reads the household's beta usage counts switch (#287)
 * for a parent. Teens and children never reach /dashboard/settings at all
 * (src/lib/kid-access.ts), and the APIs refuse them regardless.
 */
export default async function SettingsPage() {
  let sharedDevice: { hasPin: boolean } | null = null
  let betaMetrics: { enabled: boolean } | null = null
  const sessionUser = await getServerUser()
  const parentFamilyId = sessionUser && isParentRole(sessionUser.role) ? sessionUser.family_id : null
  if (sessionUser && parentFamilyId) {
    if (isSharedDeviceEnabled()) {
      const pin = await prisma!.parentElevationPin.findFirst({
        where: { user_id: sessionUser.id, family_id: parentFamilyId },
        select: { user_id: true },
      })
      sharedDevice = { hasPin: Boolean(pin) }
    }
    const family = await prisma!.family.findUnique({
      where: { id: parentFamilyId },
      select: { beta_metrics_enabled: true },
    })
    if (family) betaMetrics = { enabled: family.beta_metrics_enabled }
  }
  // Two-way calendar sync (#264) is dormant unless configured; the section
  // is not even mounted while it is off (its API would answer 404).
  return (
    <SettingsClient sharedDevice={sharedDevice} betaMetrics={betaMetrics} calendarSync={isCalendarSyncEnabled()} />
  )
}
