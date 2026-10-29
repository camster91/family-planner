import { storageBackend } from '@/lib/storage-backend'
import { getServerActor } from '@/lib/supabase/server'
import { readD1SettingsSeed } from '@/lib/cloudflare/family-preferences'
import { isAiUsageAdopted } from '@/lib/ai-usage-server'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isParentRole } from '@/lib/role-capabilities'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { isCalendarSyncEnabled } from '@/lib/calendar-sync/config'
import { isCaptureAiSettingsEnabled } from '@/lib/capture-settings-flag'
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
 *   counts switch (#287). The "AI capture" key form only when
 *   CAPTURE_AI_SETTINGS_ENABLED is on, or the household already saved a key
 *   (so it can still be removed); only the fact that a key exists is read
 *   here, never the key.
 * - Teen (O-37): personal sections only. Nothing household-level is read here
 *   or serialised to the page: no PIN presence, no beta switch, no calendar
 *   sync flag. The client also skips the parent-only fetches (AI key hint,
 *   calendar feed), and those APIs refuse teens regardless.
 * - Child: never here. The kid allowlist (src/lib/kid-access.ts) sends them
 *   home first; this check is a last line in case that gate is bypassed.
 */
export default async function SettingsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ setup?: string }> }) {
  if (storageBackend() === 'd1') {
    const actor = await getServerActor()
    if (!actor) redirect('/login')
    const seed = await readD1SettingsSeed({ userId: actor.id, generation: actor.tokenVersion }, isSharedDeviceEnabled())
    if (!seed) redirect('/login')
    if (seed.role === 'child') redirect('/dashboard')
    const viewerRole: SettingsViewerRole = isParentRole(seed.role) ? 'parent' : 'teen'
    const parentFamilyId = viewerRole === 'parent' ? seed.familyId : null
    return <SettingsClient
      viewerRole={viewerRole}
      calendarFeedReviewScope={parentFamilyId ?? undefined}
      sharedDevice={seed.sharedDevice}
      betaMetrics={seed.betaMetrics}
      calendarSync={viewerRole === 'parent' && isCalendarSyncEnabled()}
      aiCaptureSettings={Boolean(parentFamilyId && (isCaptureAiSettingsEnabled() || seed.aiKeyStored || (await searchParams).setup === 'ai'))}
      aiUsage={parentFamilyId && isAiUsageAdopted() ? { userId: actor.id, familyId: parentFamilyId } : undefined}
    />
  }
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
  let aiCaptureSettings = false
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
      select: { beta_metrics_enabled: true, capture_ai_key_enc: true },
    })
    if (family) betaMetrics = { enabled: family.beta_metrics_enabled }
    aiCaptureSettings = isCaptureAiSettingsEnabled() || Boolean(family?.capture_ai_key_enc) || (await searchParams).setup === 'ai'
  }
  // Two-way calendar sync (#264) is dormant unless configured; the section
  // is not even mounted while it is off (its API would answer 404).
  return (
    <SettingsClient
      viewerRole={viewerRole}
      calendarFeedReviewScope={parentFamilyId ?? undefined}
      sharedDevice={sharedDevice}
      betaMetrics={betaMetrics}
      calendarSync={viewerRole === 'parent' && isCalendarSyncEnabled()}
      aiCaptureSettings={aiCaptureSettings}
      aiUsage={parentFamilyId && isAiUsageAdopted() ? { userId: sessionUser.id, familyId: parentFamilyId } : undefined}
    />
  )
}
