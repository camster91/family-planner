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
 * has no /dashboard/settings entry), this page checks the database role again,
 * and `GET /api/audit` answers 403 to them regardless.
 */
export default async function ActivitySettingsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login?redirect=/dashboard/settings/activity')
  if (!isParentRole(user.role)) redirect('/dashboard')
  if (!user.family_id) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-title-1 text-label-primary">Recent changes</h1>
        <p className="mt-3 text-body text-label-secondary">Join or create a household to see its recent changes.</p>
      </div>
    )
  }
  return <ActivityClient />
}
