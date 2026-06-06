import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH /api/wishlist/[id] - Update a wishlist item (requester or parent)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await params

    const existing = await prisma!.wishlistItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing.family_id !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Only requester or parent can edit
    if (existing.requested_by !== auth.user.id && auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { title, link, description, approx_price } = body

    const updated = await prisma!.wishlistItem.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(link !== undefined && { link: link?.trim() || null }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(approx_price !== undefined && {
          approx_price: approx_price !== null ? new Prisma.Decimal(approx_price) : null,
        }),
      },
      include: {
        requester: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      item: { ...updated, approx_price: updated.approx_price ? updated.approx_price.toString() : null },
    })
  } catch (err) {
    console.error('PATCH /api/wishlist/[id] error:', err)
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

    const { id } = await params

    const existing = await prisma!.wishlistItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing.family_id !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (existing.requested_by !== auth.user.id && auth.user.role !== 'parent') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma!.wishlistItem.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/wishlist/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}