import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import {
  authorizeWishlistReplay,
  deleteWishlistWithReceipt,
  normalizeWishlistUpdate,
  updateWishlistWithReceipt,
  wishlistAction,
} from '@/lib/wishlist-write'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { updateWishlistItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/wishlist/[id] - Canonical owned-row read for mutation recovery.
// A row absent from a loaded collection page is not proof of deletion.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate
    const { id } = await params
    const item = await prisma!.wishlistItem.findFirst({
      where: { id, family_id: auth.user.family_id },
      include: {
        requester: { select: { id: true, name: true } },
        status_changer: { select: { id: true, name: true } },
      },
    })
    const headers = { 'Cache-Control': 'private, no-store' }
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
    return NextResponse.json({ item: {
      ...item, approx_price: item.approx_price == null ? null : item.approx_price.toString(),
    } }, { headers })
  } catch (err) {
    logRouteError('GET /api/wishlist/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/wishlist/[id] - Update a wishlist item (requester or parent)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    const { id } = await params

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateWishlistItemSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const input = normalizeWishlistUpdate(parsed.data)
    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: wishlistAction('update'),
      },
      { id, ...input },
      ({ recordId }) =>
        updateWishlistWithReceipt(
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
            'update',
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key,
          ),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (err) {
    logRouteError('PATCH /api/wishlist/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/wishlist/[id] - Delete a wishlist item (requester or parent)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    const { id } = await params

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: wishlistAction('delete'),
      },
      { id },
      ({ recordId }) =>
        deleteWishlistWithReceipt(
          prisma!,
          id,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeWishlistReplay(
            prisma!,
            'delete',
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key,
          ),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (err) {
    logRouteError('DELETE /api/wishlist/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
