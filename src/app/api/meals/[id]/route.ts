import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// PATCH - Update a meal slot
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const { id, recipe_name, notes, cook_id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const meal = await prisma!.familyMeal.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(meal.family_id, auth.user.family_id)
    if (familyError) return familyError

    const data: Record<string, unknown> = {}
    if (recipe_name !== undefined) data.recipe_name = recipe_name
    if (notes !== undefined) data.notes = notes
    if (cook_id !== undefined) data.cook_id = cook_id

    const updated = await prisma!.familyMeal.update({
      where: { id },
      data,
      include: {
        cook: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ meal: updated })
  } catch (err) {
    console.error('Error updating meal:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a meal slot
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const meal = await prisma!.familyMeal.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(meal.family_id, auth.user.family_id)
    if (familyError) return familyError

    await prisma!.familyMeal.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting meal:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}