import type { Metadata } from 'next'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isParentRole } from '@/lib/role-capabilities'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import SettingsClient from './SettingsClient'

export const metadata: Metadata = { title: 'Settings' }
// The shared-device kill switch is read per request.
export const dynamic = 'force-dynamic'

/**
 * Settings. The page itself is client-rendered (./SettingsClient.tsx); this
 * server wrapper only decides whether the shared-tablet entries (Devices,
 * Tablet PIN, #241) are shown: kill switch on AND a parent (role read from
 * the database). Teens and children never reach /dashboard/settings at all
 * (src/lib/kid-access.ts), and the APIs refuse them regardless.
 */
export default async function SettingsPage() {
  let sharedDevice: { hasPin: boolean } | null = null
  if (isSharedDeviceEnabled()) {
    const sessionUser = await getServerUser()
    if (sessionUser && isParentRole(sessionUser.role) && sessionUser.family_id) {
      const pin = await prisma!.parentElevationPin.findFirst({
        where: { user_id: sessionUser.id, family_id: sessionUser.family_id },
        select: { user_id: true },
      })
      sharedDevice = { hasPin: Boolean(pin) }
    }
  }
  return <SettingsClient sharedDevice={sharedDevice} />
}
