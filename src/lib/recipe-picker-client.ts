import { z } from "zod";
import { readRecipeJson } from "@/lib/recipe-read-client";

export const RECIPE_PICKER_PAGE_SIZE = 24;
const recipe = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  prep_time: z.number().finite().nonnegative().nullable(),
  cook_time: z.number().finite().nonnegative().nullable(),
  servings: z.number().finite().positive().nullable(),
});
const pageSchema = z.object({
  recipes: z.array(recipe).max(RECIPE_PICKER_PAGE_SIZE),
  nextOffset: z.number().int().nonnegative().safe().nullable(),
});

/** One canonical search page, with bounded header/body wait and explicit retry. */
export async function readRecipePickerPage(
  query: string,
  offset: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const failure = () => new Error("Recipe page unavailable");
  if (!Number.isSafeInteger(offset) || offset < 0) throw failure();
  const params = new URLSearchParams({ limit: String(RECIPE_PICKER_PAGE_SIZE), offset: String(offset) });
  if (query) params.set("q", query);
  try {
    const page = pageSchema.parse(await readRecipeJson(`/api/recipes?${params}`, signal, { fetchImpl }));
    if (new Set(page.recipes.map(row => row.id)).size !== page.recipes.length ||
      (page.nextOffset !== null && (page.recipes.length !== RECIPE_PICKER_PAGE_SIZE ||
        page.nextOffset !== offset + RECIPE_PICKER_PAGE_SIZE))) throw failure();
    return page;
  } catch {
    throw failure();
  }
}
