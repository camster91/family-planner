import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { storageBackend } from '@/lib/storage-backend'
import { D1PersonReceiptError } from '@/lib/cloudflare/person-effect'
import { idempotencyError } from '@/lib/idempotency'
import { createD1Wishlist, readD1WishlistScoped } from '@/lib/cloudflare/wishlist'
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

import { parseWishlistPaging, encodeWishlistCursor, afterWishlistCursor } from '@/lib/wishlist-paging'

export const dynamic = 'force-dynamic'

function responseHeaders(replayed?: boolean): Record<string, string> {
  return replayed
    ? { 'Idempotency-Replayed': 'true', 'Cache-Control': 'private, no-store' }
    : { 'Cache-Control': 'private, no-store' }
}

// GET /api/wishlist - List wishlist items
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'wishlist')
    if (gate) return gate

    const params = request.nextUrl.searchParams
    const scope = {
      familyId: auth.user.family_id,
      requesterId: params.get('mine') === 'true' ? auth.user.id : null,
    }
    const paging = parseWishlistPaging(params, scope)
    if (!paging.ok) return NextResponse.json({ error: paging.error }, { status: 400 })
    if (storageBackend() === 'd1') {
      const result = await readD1WishlistScoped(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 },
        { requesterId: scope.requesterId },
        paging,
      )
      return NextResponse.json(result.body, { status: result.status, headers: responseHeaders() })
    }
    const items = await prisma!.wishlistItem.findMany({
      where: {
        family_id: scope.familyId,
        ...(paging.paged && scope.requesterId ? { requested_by: scope.requesterId } : {}),
        ...(paging.paged && paging.cursor ? afterWishlistCursor(paging.cursor) : {}),
      },
      include: {
        requester: { select: { id: true, name: true } },
        status_changer: { select: { id: true, name: true } },
      },
      orderBy: paging.paged ? [{ created_at: 'desc' }, { id: 'asc' }] : { created_at: 'desc' },
      ...(paging.paged ? { take: paging.limit + 1 } : {}),
    })

    // Serialize Decimal to string for JSON
    const hasMore = paging.paged && items.length > paging.limit
    const page = paging.paged ? items.slice(0, paging.limit) : items
    const serialized = page.map((item) => ({
      ...item,
      approx_price:
        item.approx_price == null ? null : item.approx_price.toString(),
    }))

    return NextResponse.json({
      items: serialized,
      ...(paging.paged ? { nextCursor: hasMore && page.length
        ? encodeWishlistCursor(scope, page[page.length - 1]) : null } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof D1PersonReceiptError) return idempotencyError(err.code)
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

    if (storageBackend() === 'd1') {
      const result = await createD1Wishlist(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 },
        input,
        key,
      )
      return NextResponse.json(result.body, { status: result.status, headers: responseHeaders(result.replayed) })
    }

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
    if (err instanceof D1PersonReceiptError) return idempotencyError(err.code)
    logRouteError('POST /api/wishlist', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
