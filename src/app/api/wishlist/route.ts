import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// GET /api/wishlist - List wishlist items
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

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
    console.error('GET /api/wishlist error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/wishlist - Create a wishlist item (any family member)
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { title, link, description, approx_price } = body

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const item = await prisma!.wishlistItem.create({
      data: {
        family_id: auth.user.family_id,
        requested_by: auth.user.id,
        title: title.trim(),
        link: link?.trim() || null,
        description: description?.trim() || null,
        approx_price: approx_price ? new Prisma.Decimal(approx_price) : null,
      },
      include: {
        requester: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(
      { item: { ...item, approx_price: item.approx_price ? item.approx_price.toString() : null } },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/wishlist error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}