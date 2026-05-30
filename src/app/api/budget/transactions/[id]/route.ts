import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import {
  updateTransactionSchema,
  deleteTransactionSchema,
} from '@/lib/validations'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH — Update an existing transaction (family-scoped)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updateTransactionSchema.safeParse({
      ...body,
      transactionId: id,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Verify the transaction exists and belongs to the user's family
    const existing = await prisma!.transaction.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      existing.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

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

    // If category_id is being changed, verify new category belongs to the family
    if (category_id) {
      const category = await prisma!.budgetCategory.findUnique({
        where: { id: category_id },
        select: { family_id: true },
      })

      if (!category) {
        return NextResponse.json(
          { error: 'Category not found' },
          { status: 404 }
        )
      }

      const catFamilyError = requireFamilyMatch(
        category.family_id,
        auth.user.family_id
      )
      if (catFamilyError) return catFamilyError
    }

    // Build update data — only include fields that were provided
    const data: Record<string, unknown> = {}
    if (amount !== undefined) data.amount = amount
    if (type !== undefined) data.type = type
    if (category_id !== undefined) data.category_id = category_id
    if (description !== undefined) data.description = description
    if (notes !== undefined) data.notes = notes
    if (date !== undefined) data.date = new Date(date)
    if (is_recurring !== undefined) {
      data.is_recurring = is_recurring
      // If turning off recurring, clear the interval
      if (!is_recurring) {
        data.recurring_interval = null
      } else if (recurring_interval !== undefined) {
        data.recurring_interval = recurring_interval
      }
    } else if (recurring_interval !== undefined) {
      data.recurring_interval = recurring_interval
    }

    const updated = await prisma!.transaction.update({
      where: { id },
      data,
      include: {
        category: {
          select: { id: true, name: true, icon: true, color: true },
        },
        user: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
    })

    return NextResponse.json({ transaction: updated })
  } catch (error) {
    console.error('Error updating transaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — Delete a transaction (family-scoped)
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      )
    }

    // Verify the transaction exists and belongs to the user's family
    const transaction = await prisma!.transaction.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      transaction.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    await prisma!.transaction.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting transaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
