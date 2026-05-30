import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { createTransactionSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET — List transactions for the user's family
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') as 'income' | 'expense' | null
    const categoryId = searchParams.get('category_id')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0

    const where: Record<string, unknown> = {
      family_id: auth.user.family_id,
    }

    if (type && ['income', 'expense'].includes(type)) {
      where.type = type
    }

    if (categoryId) {
      where.category_id = categoryId
    }

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {}
      if (startDate) dateFilter.gte = new Date(startDate)
      if (endDate) dateFilter.lte = new Date(endDate)
      where.date = dateFilter
    }

    const [transactions, total] = await Promise.all([
      prisma!.transaction.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, icon: true, color: true },
          },
          user: {
            select: { id: true, name: true, avatar_url: true },
          },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma!.transaction.count({ where }),
    ])

    return NextResponse.json({ transactions, total, limit, offset })
  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — Create a new transaction
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createTransactionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const {
      amount,
      type,
      category_id,
      description,
      notes,
      date,
      is_recurring,
      recurring_interval,
    } = parsed.data

    // If category_id is provided, verify it belongs to the family
    if (category_id) {
      const category = await prisma!.budgetCategory.findUnique({
        where: { id: category_id },
        select: { family_id: true, type: true },
      })

      if (!category) {
        return NextResponse.json(
          { error: 'Category not found' },
          { status: 404 }
        )
      }

      const familyError = requireFamilyMatch(
        category.family_id,
        auth.user.family_id
      )
      if (familyError) return familyError

      // Warn if category type doesn't match transaction type (but allow it)
      if (category.type !== type) {
        console.warn(
          `Transaction type "${type}" doesn't match category type "${category.type}" for category ${category_id}`
        )
      }
    }

    const transaction = await prisma!.transaction.create({
      data: {
        family_id: auth.user.family_id,
        user_id: auth.user.id,
        amount,
        type,
        category_id: category_id || null,
        description: description || null,
        notes: notes || null,
        date: date ? new Date(date) : new Date(),
        is_recurring: is_recurring || false,
        recurring_interval: is_recurring ? recurring_interval || null : null,
      },
      include: {
        category: {
          select: { id: true, name: true, icon: true, color: true },
        },
        user: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
    })

    return NextResponse.json({ transaction }, { status: 201 })
  } catch (error) {
    console.error('Error creating transaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
