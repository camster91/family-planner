import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { storageBackend } from '@/lib/storage-backend'
import { D1PersonReceiptError } from '@/lib/cloudflare/person-effect'
import { idempotencyError } from '@/lib/idempotency'
import { updateD1WishlistStatus } from '@/lib/cloudflare/wishlist'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import {
  authorizeWishlistReplay,
  normalizeWishlistStatus,
  updateWishlistStatusWithReceipt,
  wishlistAction,
} from '@/lib/wishlist-write'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { wishlistStatusSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// PATCH /api/wishlist/[id]/status - Change wishlist item status (parent only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    // Parents only for status changes
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = wishlistStatusSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const input = normalizeWishlistStatus(parsed.data)
    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    if (storageBackend() === 'd1') {
      const result = await updateD1WishlistStatus(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 },
        id,
        input,
        key,
      )
      return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { 'Idempotency-Replayed': 'true', 'Cache-Control': 'private, no-store' } : { 'Cache-Control': 'private, no-store' } })
    }

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: wishlistAction('status'),
      },
      { id, ...input },
      ({ recordId }) =>
        updateWishlistStatusWithReceipt(
          prisma!,
          id,
          input,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeWishlistReplay(
            prisma!,
            'status',
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key,
          ),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (err) {
    if (err instanceof D1PersonReceiptError) return idempotencyError(err.code)
    logRouteError('PATCH /api/wishlist/[id]/status', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
