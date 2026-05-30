import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { updateCategorySchema, deleteCategorySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH — Update an existing budget category (family-scoped)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updateCategorySchema.safeParse({ ...body, categoryId: id })
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Verify the category exists and belongs to the user's family
    const existing = await prisma!.budgetCategory.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      existing.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    const { name, icon, color, type, budget_limit } = parsed.data

    // If renaming, check for duplicate within the same family
    if (name) {
      const duplicate = await prisma!.budgetCategory.findFirst({
        where: {
          family_id: auth.user.family_id,
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
          ...(type ? { type } : {}),
        },
      })

      if (duplicate) {
        return NextResponse.json(
          { error: `A category named "${name}" already exists` },
          { status: 409 }
        )
      }
    }

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (icon !== undefined) data.icon = icon
    if (color !== undefined) data.color = color
    if (type !== undefined) data.type = type
    if (budget_limit !== undefined) data.budget_limit = budget_limit

    const updated = await prisma!.budgetCategory.update({
      where: { id },
      data,
      include: {
        _count: {
          select: { transactions: true },
        },
        creator: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json({ category: updated })
  } catch (error) {
    console.error('Error updating category:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — Delete a budget category (family-scoped)
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      )
    }

    // Verify the category exists and belongs to the user's family
    const category = await prisma!.budgetCategory.findUnique({
      where: { id },
      select: { family_id: true },
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

    // Check if there are transactions using this category
    const transactionCount = await prisma!.transaction.count({
      where: { category_id: id },
    })

    if (transactionCount > 0) {
      // Nullify the category reference on existing transactions
      await prisma!.transaction.updateMany({
        where: { category_id: id },
        data: { category_id: null },
      })
    }

    await prisma!.budgetCategory.delete({ where: { id } })

    return NextResponse.json({
      success: true,
      orphaned_transactions: transactionCount,
    })
  } catch (error) {
    console.error('Error deleting category:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
