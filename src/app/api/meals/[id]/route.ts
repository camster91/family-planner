import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { parseDateOnly } from '@/lib/dates'
import { MEAL_INCLUDE, resolveMealLink } from '@/lib/meal-recipe-link'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

// PATCH - Update a meal slot. Optional `recipe_id` (same household; null
// unlinks) and `servings` (null clears). Linking without `recipe_name` sets the
// snapshot to the recipe title; unlinking keeps the existing snapshot.
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
    const { id, recipe_name, notes, cook_id, date, meal_type, recipe_id, servings } = body

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

    // The cook must be a member of the caller's family (#102).
    if (cook_id) {
      const cook = await prisma!.user.findFirst({
        where: { id: cook_id, family_id: auth.user.family_id },
        select: { id: true },
      })
      if (!cook) {
        return NextResponse.json({ error: 'Cook must be a member of your family' }, { status: 400 })
      }
    }

    const link = await resolveMealLink(prisma!, auth.user.family_id, { recipe_id, servings })
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (recipe_name !== undefined) data.recipe_name = recipe_name
    else if (link.recipeTitle !== null) data.recipe_name = link.recipeTitle
    if (link.recipeId !== undefined) data.recipe_id = link.recipeId
    if (link.servings !== undefined) data.servings = link.servings
    if (notes !== undefined) data.notes = notes
    if (cook_id !== undefined) data.cook_id = cook_id
    if (mealDate !== undefined) data.date = mealDate
    if (meal_type !== undefined) data.meal_type = meal_type

    const updated = await prisma!.familyMeal.update({
      where: { id },
      data,
      include: MEAL_INCLUDE,
    })

    return NextResponse.json({ meal: updated })
  } catch (err) {
    logRouteError('PATCH /api/meals/[id]', err, getRequestId(request))
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
    logRouteError('DELETE /api/meals/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}