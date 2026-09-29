import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { setBetaMetricsEnabled } from '@/lib/beta-metrics'
import { auditSummary, writeAuditLog } from '@/lib/household-audit'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Strict: `enabled` only. Any other key (a household id, a metric name) is a 400.
const patchSchema = z.object({ enabled: z.boolean() }).strict()

function withNoStore(res: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(NO_STORE)) res.headers.set(name, value)
  return res
}

/**
 * PATCH /api/family/beta-metrics { enabled } — turn the household's beta
 * usage counts on or off (#287, PR101 D-6; src/lib/beta-metrics.ts).
 *
 * Parents only (teen and child 403); a paired shared tablet is refused (403)
 * before person auth. Changes only the caller's own household. Turning it off
 * also deletes every stored count of the household, in the same transaction.
 * A real change is recorded in the household audit history (#285); sending
 * the current value again adds no history line (off still makes sure no
 * counts are left).
 *
 * 200 `{ betaMetrics: { enabled } }`, Cache-Control: private, no-store.
 */
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withNoStore(deviceRefusal)

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return withNoStore(error)
    const parentError = requireParent(auth.user.role)
    if (parentError) return withNoStore(parentError)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE })
    }
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Send { "enabled": true } or { "enabled": false }' },
        { status: 400, headers: NO_STORE }
      )
    }

    const familyId = auth.user.family_id
    const enabled = parsed.data.enabled
    const result = await prisma!.$transaction(async (tx) => {
      const changed = await setBetaMetricsEnabled(tx, familyId, enabled)
      if (!changed) return null
      if (changed.before !== enabled) {
        await writeAuditLog(tx, {
          familyId,
          actorUserId: auth.user.id,
          actorKind: 'person',
          action: enabled ? 'beta_metrics.turned_on' : 'beta_metrics.turned_off',
          targetType: 'family',
          targetId: familyId,
          summary: auditSummary.betaMetrics(enabled),
        })
      }
      return { enabled }
    })
    if (!result) return NextResponse.json({ error: 'Family not found' }, { status: 404, headers: NO_STORE })

    return NextResponse.json({ betaMetrics: result }, { headers: NO_STORE })
  } catch (err) {
    console.error('Beta metrics switch failed:', err instanceof Error ? err.name : 'unknown error')
    return NextResponse.json({ error: 'Could not save this setting' }, { status: 500, headers: NO_STORE })
  }
}
