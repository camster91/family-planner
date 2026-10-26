import { z } from "zod";
import { readRecipeJson } from "@/lib/recipe-read-client";
import { recipeSearchSchema } from "@/lib/recipe-search";
export const RECIPE_LIBRARY_PAGE_SIZE = 100;
const summary = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string(),
  description: z.string().nullable(),
  source_url: z.string().nullable().optional(),
  favorite: z.boolean().optional(),
});
export type RecipeLibrarySummary = z.infer<typeof summary>;
const page = z.object({ recipes: z.array(summary).max(RECIPE_LIBRARY_PAGE_SIZE),
  nextOffset: z.number().int().nonnegative().safe().nullable() });
/** One explicit canonical library page; no automatic continuation or inferred absence. */
export async function readRecipeLibraryPage(
  filters: string, offset: number, signal: AbortSignal, fetchImpl: typeof fetch = fetch,
) {
  const failure = () => new Error("Recipe library unavailable");
  try {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - RECIPE_LIBRARY_PAGE_SIZE) throw failure();
    const search = new URLSearchParams(filters);
    const allowed = new Set(["q", "ingredient", "maxPrep", "minServings", "favorite", "collection"]);
    for (const key of search.keys()) if (!allowed.has(key) || search.getAll(key).length !== 1) throw failure();
    recipeSearchSchema.parse(Object.fromEntries(search));
    const params = new URLSearchParams({ limit: String(RECIPE_LIBRARY_PAGE_SIZE), offset: String(offset) });
    for (const [key, value] of search) params.set(key, value);
    const result = page.parse(await readRecipeJson(`/api/recipes?${params}`, signal, { fetchImpl }));
    if (new Set(result.recipes.map(row => row.id)).size !== result.recipes.length ||
        (result.nextOffset !== null && (result.recipes.length !== RECIPE_LIBRARY_PAGE_SIZE ||
          result.nextOffset !== offset + RECIPE_LIBRARY_PAGE_SIZE))) throw failure();
    return result;
  } catch { throw failure(); }
}
