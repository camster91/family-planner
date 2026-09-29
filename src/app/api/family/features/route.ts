import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { defaultFeatures, normalizeFeatures, FEATURES, type FeatureKey } from '@/lib/features'
import { featureAuditEntries, writeAuditLog } from '@/lib/household-audit'

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
 * Parents only — kids and teens cannot toggle features. Each feature that
 * changed is recorded in the household audit history (#285).
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

  // Only the features named in the request change (#285 review): a
  // concurrent toggle of another feature by a second parent must survive.
  const changes: Partial<Record<FeatureKey, boolean>> = {}

  // Shape A: { features: { ... } } — bulk update
  if (body.features && typeof body.features === 'object') {
    for (const [k, v] of Object.entries(body.features)) {
      const feature = FEATURES.find((f) => f.key === k)
      if (!feature) continue // ignore unknown keys
      if (typeof v !== 'boolean') continue
      // Core features cannot be turned off
      if (feature.group === 'core' && v === false) continue
      changes[k as FeatureKey] = v
    }
  }
  // Shape B: { key, enabled } — single feature (what the UI sends)
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
    changes[body.key] = body.enabled
  } else {
    return NextResponse.json({ error: 'features object OR (key + enabled) required' }, { status: 400 })
  }

  // Read-modify-write under a row lock on the household (#285 review): the
  // stored flags are re-read inside the transaction after `FOR UPDATE`, so two
  // parents toggling different features at once serialise and neither change
  // is lost. The household audit rows are the diff between that fresh row and
  // the result, written in the same transaction. No user lock is taken, so the
  // lock order of src/lib/household-lock.ts is unaffected.
  const familyId = user.family_id
  const actorUserId = user.id
  const next = await prisma!.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`
    const family = await tx.family.findUnique({ where: { id: familyId }, select: { features: true } })
    if (!family) return null
    const current = family.features ? normalizeFeatures(family.features) : defaultFeatures()
    const updated = { ...current, ...changes }
    await tx.family.update({
      where: { id: familyId },
      data: { features: updated as any },
    })
    await writeAuditLog(tx, featureAuditEntries(current, updated, { familyId, actorUserId, actorKind: 'person' }))
    return updated
  })
  if (!next) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

  return NextResponse.json({ features: next })
}
