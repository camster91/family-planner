/** Browser-side projection of the existing canonical detail response. */
import { z } from "zod";
import { readRecipeJson } from "@/lib/recipe-read-client";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { RECIPE_MAX_INGREDIENTS } from "@/lib/recipe-input-contract";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner, type RecipeOwner } from "@/lib/recipe-owner-contract";
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
export class RecipeDetailOwnerChanged extends Error {}

/** One bounded read, no continuation, write, provider lookup or inferred target. */
export async function readRecipeDetail(
  recipeId: string, signal: AbortSignal,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; expectedOwner?: RecipeOwner } = {},
): Promise<{ recipe: RecipeDetailData; owner: RecipeOwner }> {
  if (!MEMBER_ID_PATTERN.test(recipeId)) throw new Error("Recipe detail unavailable");
  let notFound = false;
  let ownerRefused = false;
  let receivedOwner: RecipeOwner | null = null;
  try {
    const body = await readRecipeJson(`/api/recipes/${encodeURIComponent(recipeId)}`, signal, {
      fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs,
      ...(options.expectedOwner ? { headers: { [RECIPE_OWNER_HEADER]: JSON.stringify(options.expectedOwner) } } : {}),
      inspectResponse: response => {
        if ([401, 403, 409].includes(response.status)) ownerRefused = true;
        notFound = response.status === 404;
        if (!response.ok) return;
        receivedOwner = readRecipeOwner(response.headers?.get(RECIPE_OWNER_HEADER) ?? null);
        if (!receivedOwner || (options.expectedOwner && !sameRecipeOwner(options.expectedOwner, receivedOwner))) {
          ownerRefused = true;
          throw new Error("Recipe owner changed");
        }
      },
    });
    const parsed = z.object({ recipe: detail }).parse(body).recipe;
    if (signal.aborted || parsed.id !== recipeId ||
      new Set(parsed.ingredients.map(line => line.id)).size !== parsed.ingredients.length)
      throw new Error("Recipe detail unavailable");
    if (!receivedOwner) throw new Error("Recipe detail unavailable");
    return { recipe: parsed, owner: receivedOwner };
  } catch {
    if (ownerRefused && !signal.aborted) throw new RecipeDetailOwnerChanged("Recipe owner changed");
    if (notFound && !signal.aborted) throw new RecipeDetailNotFound("Recipe not found");
    throw new Error("Recipe detail unavailable");
  }
}
