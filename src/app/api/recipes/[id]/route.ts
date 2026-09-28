import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import {
  RECIPE_DETAIL_SELECT,
  RecipeInputError,
  canDeleteRecipe,
  canEditRecipe,
  resolveIngredientLines,
  updateRecipeSchema,
} from '@/lib/recipes'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

// A recipe outside the caller's household is indistinguishable from a missing
// one: every lookup is scoped by family_id and answers the same 404.
const notFound = () => NextResponse.json({ error: 'Recipe not found' }, { status: 404 })

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

// GET /api/recipes/[id] — any role (O-7).
export async function GET(request: NextRequest, context: Context) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    const { id } = await context.params
    const recipe = await prisma!.recipe.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: RECIPE_DETAIL_SELECT,
    })
    if (!recipe) return notFound()
    return NextResponse.json({ recipe })
  } catch (err) {
    console.error('Error fetching recipe:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/recipes/[id] — parent or teen (O-7). `ingredients`, when given,
// replaces the whole ingredient set.
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    if (!canEditRecipe(auth.user.role)) {
      return NextResponse.json({ error: 'Ask a parent or teen to change this recipe.' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateRecipeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { ingredients, ...fields } = parsed.data
    const familyId = auth.user.family_id
    const { id } = await context.params

    const updated = await prisma!.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({ where: { id, family_id: familyId }, select: { id: true } })
      if (!existing) return false

      const lines = ingredients ? await resolveIngredientLines(tx, familyId, ingredients) : null
      const data: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) data[key] = value
      }
      // Always touch the row so updated_at moves when only ingredients change.
      await tx.recipe.update({ where: { id }, data: { ...data, updated_at: new Date() }, select: { id: true } })
      if (lines) {
        await tx.recipeIngredient.deleteMany({ where: { recipe_id: id } })
        if (lines.length > 0) {
          await tx.recipeIngredient.createMany({ data: lines.map((l) => ({ ...l, recipe_id: id })) })
        }
      }
      return true
    })

    if (!updated) return notFound()
    // Nested detail read after commit (see POST /api/recipes).
    const recipe = await prisma!.recipe.findFirst({ where: { id, family_id: familyId }, select: RECIPE_DETAIL_SELECT })
    if (!recipe) return notFound()
    return NextResponse.json({ recipe })
  } catch (err) {
    if (err instanceof RecipeInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'The recipe changed at the same time. Please try again.' }, { status: 409 })
    }
    console.error('Error updating recipe:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/recipes/[id] — parent only (O-7). Linked meals and grocery items
// keep their rows (FK ON DELETE SET NULL; the meal keeps its recipe_name
// snapshot). A recipe still referenced by a frozen legacy MealPlanEntry is
// refused: that FK cascades, and legacy rows are never modified (ADR-0007).
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    if (!canDeleteRecipe(auth.user.role)) {
      return NextResponse.json({ error: 'Only parents can delete a recipe.' }, { status: 403 })
    }

    const { id } = await context.params
    const outcome = await prisma!.$transaction(async (tx) => {
      const existing = await tx.recipe.findFirst({ where: { id, family_id: auth.user.family_id }, select: { id: true } })
      if (!existing) return 'not_found' as const
      const legacyRefs = await tx.mealPlanEntry.count({ where: { recipe_id: id } })
      if (legacyRefs > 0) return 'legacy' as const
      await tx.recipe.delete({ where: { id }, select: { id: true } })
      return 'deleted' as const
    })

    if (outcome === 'not_found') return notFound()
    if (outcome === 'legacy') {
      return NextResponse.json(
        {
          error: {
            code: 'RECIPE_IN_ARCHIVED_PLAN',
            message: 'This recipe is part of an archived imported meal plan and cannot be deleted yet.',
            retryable: false,
          },
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting recipe:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
