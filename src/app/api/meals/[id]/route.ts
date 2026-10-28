import { mutateBatchedMeal } from '@/lib/batched-meal-edit'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { parseDateOnly } from '@/lib/dates'
import { MEAL_INCLUDE, resolveMealLink } from '@/lib/meal-recipe-link'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { updateMealSchema } from '@/lib/validations'
import { authorizeMealBatchInTx, batchJson } from '@/lib/meal-batch-api'

export const dynamic = 'force-dynamic'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

// GET - Read one meal under the caller's exact current household/session
// context. The meals page uses this bounded read after an interrupted delete;
// it must never infer absence from a range/paginated collection.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const expectedUserId = searchParams.get('expected_user_id')
    const expectedFamilyId = searchParams.get('expected_family_id')
    const expectedGeneration = searchParams.get('expected_generation')
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    }

    // The exact read renews the authenticated actor under the same ordered
    // user/household locks used by meal mutations. The initial HTTP auth is a
    // gate, not the final authority for an Undo receipt.
    const result = await prisma!.$transaction(async (tx) => {
      const refusal = await authorizeMealBatchInTx(tx, actor, true)
      if (refusal) return { kind: 'response' as const, response: batchJson(refusal) }

      if (expectedUserId !== null || expectedFamilyId !== null || expectedGeneration !== null) {
        const generation = expectedGeneration === null ? NaN : Number(expectedGeneration)
        if (
          !expectedUserId ||
          !expectedFamilyId ||
          !Number.isSafeInteger(generation) ||
          generation < 0 ||
          actor.userId !== expectedUserId ||
          actor.familyId !== expectedFamilyId ||
          actor.tokenVersion !== generation
        )
          return {
            kind: 'response' as const,
            response: NextResponse.json(
              { error: { code: 'MEAL_OWNER_CHANGED' } },
              { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
            ),
          }
      }

      const meal = await tx.familyMeal.findUnique({
        where: { id },
        select: { id: true, family_id: true },
      })
      if (meal) {
        const familyError = requireFamilyMatch(meal.family_id, actor.familyId)
        if (familyError) return { kind: 'response' as const, response: familyError }
      }

      return {
        kind: meal ? ('present' as const) : ('missing' as const),
        mealId: meal?.id ?? id,
        context: {
          userId: actor.userId,
          familyId: actor.familyId,
          generation: actor.tokenVersion,
        },
      }
    })

    if (result.kind === 'response') return result.response
    return NextResponse.json(
      {
        state: result.kind,
        meal: { id: result.mealId },
        context: result.context,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    logRouteError('GET /api/meals/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
    const fields = updateMealSchema.safeParse(body)
    if (!fields.success) {
      return NextResponse.json({ error: fields.error.issues[0].message }, { status: 400 })
    }
    const { id, recipe_name, notes, cook_id } = fields.data
    const { date, meal_type, recipe_id, servings } = body

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
      select: { family_id: true, batch_id: true },
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

    if (meal.batch_id) return mutateBatchedMeal({ userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0 }, id, data as Prisma.FamilyMealUncheckedUpdateInput)

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

    const expectedUserId = searchParams.get('expected_user_id')
    const expectedFamilyId = searchParams.get('expected_family_id')
    const expectedGeneration = searchParams.get('expected_generation')
    const hasExpectedOwner =
      expectedUserId !== null ||
      expectedFamilyId !== null ||
      expectedGeneration !== null
    let expectedOwner:
      | { userId: string; familyId: string; generation: number }
      | undefined
    if (hasExpectedOwner) {
      const generation = expectedGeneration === null ? NaN : Number(expectedGeneration)
      if (
        !expectedUserId ||
        !expectedFamilyId ||
        !Number.isSafeInteger(generation) ||
        generation < 0
      )
        return NextResponse.json(
          { error: { code: 'MEAL_OWNER_CHANGED' } },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        )
      expectedOwner = {
        userId: expectedUserId,
        familyId: expectedFamilyId,
        generation,
      }
    }

    // Recovery deletes carry the exact owner snapshot captured by the prior
    // read. The existing meal authority transaction rechecks it under the
    // ordered locks, with no nested transaction for batched meals. Legacy
    // callers omit these parameters and retain the existing path below.
    if (expectedOwner) {
      return mutateBatchedMeal(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          tokenVersion: auth.payload.tv ?? 0,
        },
        id,
        undefined,
        expectedOwner,
      )
    }

    const meal = await prisma!.familyMeal.findUnique({
      where: { id },
      select: { family_id: true, batch_id: true },
    })

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(meal.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (meal.batch_id) return mutateBatchedMeal({ userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0 }, id)
    await prisma!.familyMeal.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    logRouteError('DELETE /api/meals/[id]', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
