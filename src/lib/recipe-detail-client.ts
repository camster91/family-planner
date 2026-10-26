/** Browser-side projection of the existing canonical detail response. */
import { z } from "zod";
import { readRecipeJson } from "@/lib/recipe-read-client";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { RECIPE_MAX_INGREDIENTS } from "@/lib/recipe-input-contract";
import type { RecipeDetailData } from "@/components/meals/RecipeDetail";

const id = z.string().regex(MEMBER_ID_PATTERN);
const minutes = z.number().int().nonnegative().safe().nullable();
const detail = z.object({
  id, title: z.string(), source_url: z.string().nullable().optional(),
  favorite: z.boolean().optional(), revision: z.number().int().nonnegative().safe().optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  description: z.string().nullable(), instructions: z.string().nullable(),
  prep_time: minutes, cook_time: minutes,
  servings: z.number().int().positive().safe().nullable(),
  ingredients: z.array(z.object({
    id, amount: z.number().finite().nonnegative(), unit: z.string().nullable(), note: z.string().nullable(),
    ingredient: z.object({ id, name: z.string(), unit: z.string().nullable() }),
  })).max(RECIPE_MAX_INGREDIENTS),
});
export class RecipeDetailNotFound extends Error {}

/** One bounded read, no continuation, write, provider lookup or inferred target. */
export async function readRecipeDetail(
  recipeId: string, signal: AbortSignal,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RecipeDetailData> {
  if (!MEMBER_ID_PATTERN.test(recipeId)) throw new Error("Recipe detail unavailable");
  let notFound = false;
  try {
    const body = await readRecipeJson(`/api/recipes/${encodeURIComponent(recipeId)}`, signal, {
      ...options,
      inspectResponse: response => { notFound = response.status === 404; },
    });
    const parsed = z.object({ recipe: detail }).parse(body).recipe;
    if (signal.aborted || parsed.id !== recipeId ||
      new Set(parsed.ingredients.map(line => line.id)).size !== parsed.ingredients.length)
      throw new Error("Recipe detail unavailable");
    return parsed;
  } catch {
    if (notFound && !signal.aborted) throw new RecipeDetailNotFound("Recipe not found");
    throw new Error("Recipe detail unavailable");
  }
}
