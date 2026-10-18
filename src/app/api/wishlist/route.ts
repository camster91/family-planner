import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import {
  authorizeWishlistReplay,
  createWishlistWithReceipt,
  normalizeWishlistCreate,
  wishlistAction,
} from '@/lib/wishlist-write'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createWishlistItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/wishlist - List wishlist items
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    const items = await prisma!.wishlistItem.findMany({
      where: { family_id: auth.user.family_id },
      include: {
        requester: { select: { id: true, name: true } },
        status_changer: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    // Serialize Decimal to string for JSON
    const serialized = items.map((item) => ({
      ...item,
      approx_price: item.approx_price ? item.approx_price.toString() : null,
    }))

    return NextResponse.json({ items: serialized })
  } catch (err) {
    logRouteError('GET /api/wishlist', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/wishlist - Create a wishlist item (any family member)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createWishlistItemSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const input = normalizeWishlistCreate(parsed.data)
    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: wishlistAction('create'),
      },
      input,
      ({ recordId }) =>
        createWishlistWithReceipt(
          prisma!,
          input,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeWishlistReplay(prisma!, 'create', {
            familyId: auth.user.family_id,
            userId: auth.user.id,
          }),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (err) {
    logRouteError('POST /api/wishlist', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
