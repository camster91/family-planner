import { redirect, notFound } from 'next/navigation'
import { getServerActor } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { financeArchiveReviewEnabled } from '@/lib/finance-archive-read'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { storageBackend } from '@/lib/storage-backend'
import { withD1ReadClient } from '@/lib/cloudflare/read-client'
import ArchiveReview from './ArchiveReview'
export const dynamic = 'force-dynamic'
export default async function ImportedFinancePage() {
  const actor = await getServerActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'parent' || !actor.family_id) redirect('/dashboard')
  if (!financeArchiveReviewEnabled()) notFound()
  if (storageBackend() === 'd1') {
    // This page is an archive review surface, so only read the current
    // household authority and feature flag here; imported rows remain behind
    // the explicit archive-review switch and are not eagerly loaded.
    const current = await withD1ReadClient(async (db) => {
      const [user, family] = await Promise.all([
        db.user.findUnique({ where: { id: actor.id }, select: { role: true, family_id: true, token_version: true } }),
        db.family.findUnique({ where: { id: actor.family_id! }, select: { features: true } }),
      ])
      return { user, family }
    })
    if (!current.user || current.user.token_version !== actor.tokenVersion) redirect('/login')
    if (current.user.role !== 'parent' || current.user.family_id !== actor.family_id) redirect('/dashboard')
    const storedFeatures = typeof current.family?.features === 'string'
      ? (() => { try { return JSON.parse(current.family.features as string) } catch { return {} } })()
      : current.family?.features
    if (!isFeatureEnabled(normalizeFeatures(storedFeatures), 'budget')) redirect('/dashboard/budget')
    return <ArchiveReview owner={{ userId: actor.id, familyId: actor.family_id, generation: actor.tokenVersion }} />
  }
  const current = await prisma!.user.findUnique({ where: { id: actor.id }, select: { role: true, family_id: true, token_version: true, family: { select: { features: true } } } })
  if (!current || current.token_version !== actor.tokenVersion) redirect('/login')
  if (current.role !== 'parent' || current.family_id !== actor.family_id) redirect('/dashboard')
  if (!isFeatureEnabled(normalizeFeatures(current.family?.features), 'budget')) redirect('/dashboard/budget')
  return <ArchiveReview owner={{ userId: actor.id, familyId: actor.family_id, generation: actor.tokenVersion }} />
}
