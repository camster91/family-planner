import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import {
  RECIPE_DETAIL_SELECT,
  RECIPE_SUMMARY_SELECT,
  RecipeInputError,
  canEditRecipe,
  createRecipeSchema,
  resolveIngredientLines,
} from '@/lib/recipes'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

// GET /api/recipes?limit=&offset= — the household's recipes (summary fields),
// ordered by title. Every role may read (O-7).
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const limitRaw = searchParams.get('limit')
    const offsetRaw = searchParams.get('offset')
    const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw)
    const offset = offsetRaw === null ? 0 : Number(offsetRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isInteger(offset) || offset < 0) {
      return NextResponse.json({ error: `limit must be 1-${MAX_LIMIT} and offset >= 0` }, { status: 400 })
    }

    const rows = await prisma!.recipe.findMany({
      where: { family_id: auth.user.family_id },
      select: { ...RECIPE_SUMMARY_SELECT, _count: { select: { ingredients: true } } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const recipes = hasMore ? rows.slice(0, limit) : rows
    return NextResponse.json({ recipes, nextOffset: hasMore ? offset + limit : null })
  } catch (err) {
    console.error('Error fetching recipes:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/recipes — parent or teen (O-7). Nested ingredients are resolved
// in the caller's household only (src/lib/recipes.ts).
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    if (!canEditRecipe(auth.user.role)) {
      return NextResponse.json({ error: 'Ask a parent or teen to add a recipe.' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createRecipeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data
    const familyId = auth.user.family_id

    const recipeId = await prisma!.$transaction(async (tx) => {
      const lines = await resolveIngredientLines(tx, familyId, data.ingredients ?? [])
      const created = await tx.recipe.create({
        data: {
          family_id: familyId,
          title: data.title,
          description: data.description ?? null,
          instructions: data.instructions ?? null,
          prep_time: data.prep_time ?? null,
          cook_time: data.cook_time ?? null,
          servings: data.servings ?? 2,
          created_by: auth.user.id,
        },
        select: { id: true },
      })
      if (lines.length > 0) {
        await tx.recipeIngredient.createMany({ data: lines.map((l) => ({ ...l, recipe_id: created.id })) })
      }
      return created.id
    })
    // Read the nested detail after commit: Prisma runs relation reads in
    // parallel, which a pg transaction client does not support cleanly.
    const recipe = await prisma!.recipe.findFirst({ where: { id: recipeId, family_id: familyId }, select: RECIPE_DETAIL_SELECT })

    return NextResponse.json({ recipe }, { status: 201 })
  } catch (err) {
    if (err instanceof RecipeInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'The recipe changed at the same time. Please try again.' }, { status: 409 })
    }
    console.error('Error creating recipe:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
