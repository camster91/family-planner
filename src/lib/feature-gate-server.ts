import { storageBackend } from '@/lib/storage-backend'
import { withD1ReadClient } from '@/lib/cloudflare/read-client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isFeatureEnabled, normalizeFeatures, type FeatureKey } from '@/lib/features'

/**
 * Server-side feature-flag gate for API handlers.
 *
 * Feature flags were historically UI-only: the nav hid disabled features but
 * their POST/PATCH/DELETE endpoints happily accepted writes. This helper is
 * the enforcement half — call it after auth in every handler of a
 * feature-scoped route:
 *
 *   const gate = await featureGate(auth.user.family_id, 'meals')
 *   if (gate) return gate
 *
 * Returns null when the feature is enabled (or family_id is unknown, in which
 * case other auth layers already rejected the request), otherwise a 403.
 * "Enabled" is the effective value: Rewards and Analytics are also off while
 * Points & streaks (`gamification`) is off (#248).
 * Core features cannot be disabled (family/features PATCH rejects them), so
 * core routes do not need this.
 */
export async function featureGate(
  familyId: string | null | undefined,
  key: FeatureKey
): Promise<NextResponse | null> {
  if (!familyId) return null

  const query = { where: { id: familyId }, select: { features: true } } as const
  const family = storageBackend() === 'd1'
    ? await withD1ReadClient(db => db.family.findUnique(query))
    : await prisma!.family.findUnique(query)
  const features = normalizeFeatures(family?.features)
  if ((family || storageBackend() !== 'd1') && isFeatureEnabled(features, key)) return null

  return NextResponse.json(
    { error: 'This feature is turned off for your family' },
    { status: 403 }
  )
}