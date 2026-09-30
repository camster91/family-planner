import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { isParentRole } from '@/lib/role-capabilities'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import DevicesManager from '@/components/device/DevicesManager'

export const metadata: Metadata = { title: 'Devices' }
// The kill switch is read per request.
export const dynamic = 'force-dynamic'

/**
 * Shared-tablet management (SHARED_DEVICE.md §7, #241). Parent only: teens
 * and children are redirected by the kid allowlist before they get here
 * (src/lib/kid-access.ts has no /dashboard/settings entry), this page checks
 * the database role again, and every /api/family/devices route answers
 * 403 PARENT_REQUIRED to them. With the kill switch off the page does not exist.
 */
export default async function DevicesSettingsPage() {
  if (!isSharedDeviceEnabled()) notFound()
  const user = await getServerUser()
  if (!user) redirect('/login?redirect=/dashboard/settings/devices')
  if (!isParentRole(user.role)) redirect('/dashboard')
  if (!user.family_id) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-title-1 text-label-primary">Devices</h1>
        <p className="mt-3 text-body text-label-secondary">Join or create a household to pair a family tablet.</p>
      </div>
    )
  }
  return <DevicesManager />
}
