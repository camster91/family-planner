/**
 * Optional recipe link on a meal slot (ADR-0007, #251).
 *
 * `/api/meals` POST and `/api/meals/[id]` PATCH accept `recipe_id` and
 * `servings`. Old clients never send them, so both are optional; `null`
 * clears them on PATCH. A `recipe_id` must name a recipe of the caller's
 * household. A foreign or missing id gets the same 400, so the response does
 * not reveal whether another household's recipe exists.
 */
import type { PrismaClient } from '@prisma/client'
import { MEAL_RECIPE_SELECT } from '@/lib/recipes'

/** Relations every meal response includes. */
export const MEAL_INCLUDE = {
  cook: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  recipe: { select: MEAL_RECIPE_SELECT },
} as const

export type MealLinkInput = {
  recipe_id?: unknown
  servings?: unknown
}

export type MealLinkResult =
  | {
      ok: true
      /** undefined: not sent; null: clear; string: a same-family recipe id. */
      recipeId: string | null | undefined
      recipeTitle: string | null
      servings: number | null | undefined
    }
  | { ok: false; error: string }

export async function resolveMealLink(
  db: Pick<PrismaClient, 'recipe'>,
  familyId: string,
  input: MealLinkInput
): Promise<MealLinkResult> {
  const { recipe_id, servings } = input

  if (servings !== undefined && servings !== null) {
    if (typeof servings !== 'number' || !Number.isInteger(servings) || servings < 1 || servings > 100) {
      return { ok: false, error: 'servings must be a whole number from 1 to 100' }
    }
  }
  const servingsValue = servings as number | null | undefined

  if (recipe_id === undefined || recipe_id === null) {
    return { ok: true, recipeId: recipe_id, recipeTitle: null, servings: servingsValue }
  }
  if (typeof recipe_id !== 'string' || recipe_id.length === 0 || recipe_id.length > 128) {
    return { ok: false, error: 'recipe_id must be a recipe id' }
  }
  const recipe = await db.recipe.findFirst({
    where: { id: recipe_id, family_id: familyId },
    select: { id: true, title: true },
  })
  if (!recipe) return { ok: false, error: 'Recipe not found' }
  return { ok: true, recipeId: recipe.id, recipeTitle: recipe.title, servings: servingsValue }
}
