import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { addUTCDays, parseDateOnly, startOfTodayUTC } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
type MealType = typeof MEAL_TYPES[number]

// GET - List meals for the current family.
// Optional `start`/`end` (YYYY-MM-DD, end exclusive) select a date-only range;
// otherwise returns the next 7 days starting from today (UTC).
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')

    let rangeStart = startOfTodayUTC()
    let rangeEnd = addUTCDays(rangeStart, 7)

    if (startParam !== null) {
      const parsed = parseDateOnly(startParam)
      if (!parsed) {
        return NextResponse.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 })
      }
      rangeStart = parsed
      rangeEnd = addUTCDays(parsed, 7)
    }
    if (endParam !== null) {
      const parsed = parseDateOnly(endParam)
      if (!parsed) {
        return NextResponse.json({ error: 'end must be YYYY-MM-DD' }, { status: 400 })
      }
      rangeEnd = parsed
    }
    if (rangeEnd <= rangeStart || rangeEnd.getTime() - rangeStart.getTime() > 62 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const meals = await prisma!.familyMeal.findMany({
      where: {
        family_id: auth.user.family_id,
        date: {
          gte: rangeStart,
          lt: rangeEnd,
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

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { date, meal_type, recipe_name, notes, cook_id } = body

    if (!date || !meal_type) {
      return NextResponse.json({ error: 'date and meal_type are required' }, { status: 400 })
    }

    if (!MEAL_TYPES.includes(meal_type)) {
      return NextResponse.json({ error: `meal_type must be one of: ${MEAL_TYPES.join(', ')}` }, { status: 400 })
    }

    // Meal dates are date-only: stored as UTC midnight of the given day.
    const mealDate = parseDateOnly(date)
    if (!mealDate) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }

    const meal = await prisma!.familyMeal.create({
      data: {
        family_id: auth.user.family_id,
        date: mealDate,
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