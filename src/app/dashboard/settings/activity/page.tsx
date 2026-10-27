import { HouseholdPageState } from '@/components/layout/DashboardRecoveryCopy'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { isParentRole } from '@/lib/role-capabilities'
import ActivityClient from './ActivityClient'

export const metadata: Metadata = { title: 'Recent changes' }
export const dynamic = 'force-dynamic'

/**
 * Household audit history (#285, PR101 D-4). Parent only: teens and children
 * are redirected by the kid allowlist before they get here (src/lib/kid-access.ts
 * lets a teen open only the Settings page itself, never a sub-route), this page
 * checks the session role again,
 * and `GET /api/audit` answers 403 to them regardless.
 */
export default async function ActivitySettingsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login?redirect=/dashboard/settings/activity')
  if (!isParentRole(user.role)) redirect('/dashboard')
  if (!user.family_id) return <HouseholdPageState page="activity" />

  return <ActivityClient />
}
