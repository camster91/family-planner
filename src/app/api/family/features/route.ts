import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { defaultFeatures, normalizeFeatures, FEATURES, type FeatureKey } from '@/lib/features'

// getServerUser returns a narrow type but the actual JWT payload includes role + family_id.
type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

/**
 * GET /api/family/features
 * Returns the current family's enabled features.
 * Parents get full read; kids/teen can read too (so the UI can gate itself).
 */
export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) {
    return NextResponse.json({ features: defaultFeatures() })
  }

  const family = await prisma!.family.findUnique({
    where: { id: user.family_id },
    select: { features: true },
  })

  const features = family?.features
    ? normalizeFeatures(family.features)
    : defaultFeatures()

  return NextResponse.json({ features })
}

/**
 * PATCH /api/family/features
 * Body: { features: { key1: bool, key2: bool, ... } }
 *   OR: { key: FeatureKey, enabled: boolean } (single feature)
 * Parents only — kids and teens cannot toggle features.
 */
export async function PATCH(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can change features' }, { status: 403 })
  }
  if (!user.family_id) {
    return NextResponse.json({ error: 'No family' }, { status: 400 })
  }

  let body: { features?: Record<string, boolean>; key?: FeatureKey; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const family = await prisma!.family.findUnique({
    where: { id: user.family_id },
    select: { features: true },
  })
  const current = family?.features
    ? normalizeFeatures(family.features)
    : defaultFeatures()
  const next = { ...current }

  // Shape A: { features: { ... } } — bulk update (used by the UI's optimistic update)
  if (body.features && typeof body.features === 'object') {
    for (const [k, v] of Object.entries(body.features)) {
      const feature = FEATURES.find((f) => f.key === k)
      if (!feature) continue // ignore unknown keys
      if (typeof v !== 'boolean') continue
      // Core features cannot be turned off
      if (feature.group === 'core' && v === false) continue
      next[k as FeatureKey] = v
    }
  }
  // Shape B: { key, enabled } — single feature (kept for backwards compat + future API)
  else if (body.key && typeof body.enabled === 'boolean') {
    const feature = FEATURES.find((f) => f.key === body.key)
    if (!feature) {
      return NextResponse.json({ error: 'Unknown feature' }, { status: 400 })
    }
    if (feature.group === 'core' && body.enabled === false) {
      return NextResponse.json(
        { error: `${feature.title} is a core feature and cannot be disabled` },
        { status: 400 }
      )
    }
    next[body.key] = body.enabled
  } else {
    return NextResponse.json({ error: 'features object OR (key + enabled) required' }, { status: 400 })
  }

  await prisma!.family.update({
    where: { id: user.family_id },
    data: { features: next as any },
  })

  return NextResponse.json({ features: next })
}
