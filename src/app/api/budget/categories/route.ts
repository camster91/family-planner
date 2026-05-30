import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createCategorySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET — List budget categories for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') as 'income' | 'expense' | null

    const where: Record<string, unknown> = {
      family_id: auth.user.family_id,
    }

    if (type && ['income', 'expense'].includes(type)) {
      where.type = type
    }

    const categories = await prisma!.budgetCategory.findMany({
      where,
      include: {
        _count: {
          select: { transactions: true },
        },
        creator: {
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ categories })
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — Create a new budget category
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { name, icon, color, type, budget_limit } = parsed.data

    // Check for duplicate name within the same family and type
    const existing = await prisma!.budgetCategory.findFirst({
      where: {
        family_id: auth.user.family_id,
        name: { equals: name, mode: 'insensitive' },
        type,
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: `A ${type} category named "${name}" already exists` },
        { status: 409 }
      )
    }

    const category = await prisma!.budgetCategory.create({
      data: {
        family_id: auth.user.family_id,
        name,
        icon: icon || '📦',
        color: color || '#6B7280',
        type: type || 'expense',
        budget_limit: budget_limit ?? null,
        created_by: auth.user.id,
      },
      include: {
        _count: {
          select: { transactions: true },
        },
        creator: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json({ category }, { status: 201 })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
