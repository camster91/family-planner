import { redirect, notFound } from 'next/navigation'
import { getServerActor } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { financeArchiveReviewEnabled } from '@/lib/finance-archive-read'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import ArchiveReview from './ArchiveReview'
export const dynamic = 'force-dynamic'
export default async function ImportedFinancePage() {
  const actor = await getServerActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'parent' || !actor.family_id) redirect('/dashboard')
  if (!financeArchiveReviewEnabled()) notFound()
  const current = await prisma!.user.findUnique({ where: { id: actor.id }, select: { role: true, family_id: true, token_version: true, family: { select: { features: true } } } })
  if (!current || current.token_version !== actor.tokenVersion) redirect('/login')
  if (current.role !== 'parent' || current.family_id !== actor.family_id) redirect('/dashboard')
  if (!isFeatureEnabled(normalizeFeatures(current.family?.features), 'budget')) redirect('/dashboard/budget')
  return <ArchiveReview owner={{ userId: actor.id, familyId: actor.family_id, generation: actor.tokenVersion }} />
}
