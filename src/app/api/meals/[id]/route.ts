import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { parseDateOnly } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

// PATCH - Update a meal slot
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const { id, recipe_name, notes, cook_id, date, meal_type } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    let mealDate: Date | undefined
    if (date !== undefined) {
      const parsed = parseDateOnly(date)
      if (!parsed) {
        return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
      }
      mealDate = parsed
    }

    if (meal_type !== undefined && !MEAL_TYPES.includes(meal_type)) {
      return NextResponse.json({ error: `meal_type must be one of: ${MEAL_TYPES.join(', ')}` }, { status: 400 })
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
    if (mealDate !== undefined) data.date = mealDate
    if (meal_type !== undefined) data.meal_type = meal_type

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

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

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