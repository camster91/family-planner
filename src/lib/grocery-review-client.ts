import { readRecipeJson } from "@/lib/recipe-read-client";
/** Read-only recipe grocery review. No write, idempotency key or automatic retry. */
export async function readGroceryReview(
  params: URLSearchParams,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  try {
    return await readRecipeJson(`/api/lists/items/from-recipe/review?${params}`, signal, { fetchImpl });
  } catch {
    throw new Error("Grocery review unavailable");
  }
}
