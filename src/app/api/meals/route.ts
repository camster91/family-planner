import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
type MealType = typeof MEAL_TYPES[number]

// GET - List meals for the current family for the next 7 days
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const weekEnd = new Date(today)
    weekEnd.setDate(today.getDate() + 7)
    weekEnd.setHours(0, 0, 0, 0)

    const meals = await prisma!.familyMeal.findMany({
      where: {
        family_id: auth.user.family_id,
        date: {
          gte: today,
          lt: weekEnd,
        },
      },
      include: {
        cook: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { date: 'asc' },
    })

    return NextResponse.json({ meals })
  } catch (err) {
    console.error('Error fetching meals:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a meal slot
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()

    const { date, meal_type, recipe_name, notes, cook_id } = body

    if (!date || !meal_type) {
      return NextResponse.json({ error: 'date and meal_type are required' }, { status: 400 })
    }

    if (!MEAL_TYPES.includes(meal_type)) {
      return NextResponse.json({ error: `meal_type must be one of: ${MEAL_TYPES.join(', ')}` }, { status: 400 })
    }

    const meal = await prisma!.familyMeal.create({
      data: {
        family_id: auth.user.family_id,
        date: new Date(date),
        meal_type,
        recipe_name: recipe_name ?? '',
        notes: notes ?? null,
        cook_id: cook_id ?? null,
        created_by: auth.user.id,
      },
      include: {
        cook: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ meal }, { status: 201 })
  } catch (err) {
    console.error('Error creating meal:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}