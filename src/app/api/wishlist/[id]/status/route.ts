import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH /api/wishlist/[id]/status - Change wishlist item status (parent only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // Parents only for status changes
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const { id } = await params

    const existing = await prisma!.wishlistItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing.family_id !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { status, denied_reason } = body

    const validStatuses = ['idle', 'on_the_way', 'received', 'denied']
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (status === 'denied' && !denied_reason) {
      return NextResponse.json({ error: 'Denial reason required when denying' }, { status: 400 })
    }

    const updated = await prisma!.wishlistItem.update({
      where: { id },
      data: {
        status,
        denied_reason: status === 'denied' ? denied_reason : null,
        status_changed_at: new Date(),
        status_changed_by: auth.user.id,
      },
      include: {
        requester: { select: { id: true, name: true } },
        status_changer: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      item: { ...updated, approx_price: updated.approx_price ? updated.approx_price.toString() : null },
    })
  } catch (err) {
    console.error('PATCH /api/wishlist/[id]/status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}