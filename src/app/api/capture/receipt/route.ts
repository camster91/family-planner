import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { isValidIdempotencyKey } from '@/lib/idempotency-key'
import { CAPTURE_CHILD_MESSAGE, canCreateList, canUseCapture } from '@/lib/role-capabilities'
import { featureGate } from '@/lib/feature-gate-server'
import type { CaptureRecoveryAction } from '@/lib/capture-recovery'

export const dynamic = 'force-dynamic'

const ACTIONS = new Set<CaptureRecoveryAction>(['event.create', 'capture.grocery.add'])
const HASH_PATTERN = /^[a-f0-9]{64}$/

function privateResponse(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function storedResourceId(body: unknown, action: CaptureRecoveryAction): string | null {
  if (!body || typeof body !== 'object') return null
  const resource = (body as Record<string, unknown>)[action === 'event.create' ? 'event' : 'item']
  if (!resource || typeof resource !== 'object') return null
  const id = (resource as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * GET /api/capture/receipt with Idempotency-Key, X-Capture-Action and
 * X-Capture-Request-Hash headers. Fingerprints stay out of the URL.
 *
 * This is deliberately a state-only read. It never returns the stored receipt
 * body or confirms another user's/family's key. A later POST still performs
 * the ordinary fresh auth, feature and ownership checks.
 */
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error
  if (!canUseCapture(auth.user.role)) return privateResponse({ error: CAPTURE_CHILD_MESSAGE }, { status: 403 })

  const key = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const action = request.headers.get('X-Capture-Action') ?? ''
  const requestHash = request.headers.get('X-Capture-Request-Hash') ?? ''
  if (!isValidIdempotencyKey(key) || !ACTIONS.has(action as CaptureRecoveryAction) || !HASH_PATTERN.test(requestHash)) {
    return privateResponse({ error: 'Invalid capture receipt headers' }, { status: 400 })
  }

  const typedAction = action as CaptureRecoveryAction
  // Receipt reads must enforce the same capability and family feature gate as
  // the corresponding fresh write before revealing whether a key exists.
  if (typedAction === 'capture.grocery.add') {
    const listsGate = await featureGate(auth.user.family_id, 'lists')
    if (listsGate) return listsGate
    if (!canCreateList(auth.user.role)) return privateResponse({ error: 'Ask a parent to add this.' }, { status: 403 })
  }
  const record = await prisma!.idempotencyRecord.findFirst({
    where: { scope: `user:${auth.user.id}`, key },
    select: {
      family_id: true,
      action: true,
      request_hash: true,
      response_status: true,
      response_body: true,
      expires_at: true,
    },
  })

  // Same response for a missing record and a record in another household. The
  // query is already user-scoped, but the family check protects against stale
  // sessions and preserves a non-confirming cross-family response.
  if (!record || record.family_id !== auth.user.family_id) return privateResponse({ state: 'absent' })
  if (record.expires_at.getTime() <= Date.now()) return privateResponse({ state: 'expired' })
  if (record.action !== typedAction || record.request_hash !== requestHash) {
    return privateResponse(
      { error: { code: 'CAPTURE_RECEIPT_CONFLICT', message: 'This capture does not match the saved request.' } },
      { status: 409 },
    )
  }
  if (record.response_status == null) return privateResponse({ state: 'pending' })

  const resourceId = storedResourceId(record.response_body, typedAction)
  if (!resourceId) return privateResponse({ state: 'committed', current: 'unknown' })

  if (typedAction === 'event.create') {
    const event = await prisma!.event.findUnique({ where: { id: resourceId }, select: { id: true, family_id: true } })
    return privateResponse({ state: 'committed', current: event?.family_id === auth.user.family_id ? 'present' : 'removed' })
  }

  const item = await prisma!.listItem.findUnique({
    where: { id: resourceId },
    select: { id: true, list: { select: { family_id: true } } },
  })
  return privateResponse({ state: 'committed', current: item?.list.family_id === auth.user.family_id ? 'present' : 'removed' })
}
