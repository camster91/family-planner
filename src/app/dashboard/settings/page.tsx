import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isParentRole } from '@/lib/role-capabilities'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { isCalendarSyncEnabled } from '@/lib/calendar-sync/config'
import SettingsClient, { type SettingsViewerRole } from './SettingsClient'

export const metadata: Metadata = { title: 'Settings' }
// The shared-device kill switch is read per request.
export const dynamic = 'force-dynamic'

/**
 * Settings. The page itself is client-rendered (./SettingsClient.tsx); this
 * server wrapper reads the viewer's role from the database (like the dashboard
 * layout, so a role change applies at once) and decides what the client gets:
 *
 * - Parent: everything, including the shared-tablet entries (Devices, Tablet
 *   PIN, #241: kill switch on AND a parent) and the household's beta usage
 *   counts switch (#287).
 * - Teen (O-37): personal sections only. Nothing household-level is read here
 *   or serialised to the page: no PIN presence, no beta switch, no calendar
 *   sync flag. The client also skips the parent-only fetches (AI key hint,
 *   calendar feed), and those APIs refuse teens regardless.
 * - Child: never here. The kid allowlist (src/lib/kid-access.ts) sends them
 *   home first; this check is a last line in case that gate is bypassed.
 */
export default async function SettingsPage() {
  const sessionUser = await getServerUser()
  if (!sessionUser) redirect('/login')
  const profile = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true, family_id: true },
  })
  const role = profile?.role ?? sessionUser.role
  if (role === 'child') redirect('/dashboard')
  const viewerRole: SettingsViewerRole = isParentRole(role) ? 'parent' : 'teen'

  let sharedDevice: { hasPin: boolean } | null = null
  let betaMetrics: { enabled: boolean } | null = null
  const parentFamilyId = viewerRole === 'parent' ? (profile?.family_id ?? null) : null
  if (parentFamilyId) {
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
    <SettingsClient
      viewerRole={viewerRole}
      sharedDevice={sharedDevice}
      betaMetrics={betaMetrics}
      calendarSync={viewerRole === 'parent' && isCalendarSyncEnabled()}
    />
  )
}
