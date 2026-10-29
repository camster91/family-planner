/** Pure recipe-to-grocery contract values shared by PostgreSQL and native D1.
 * Keep this module free of HTTP/server imports so Cloudflare Worker bundles can
 * reuse the exact source/provenance rules without pulling Next route code. */
export const ADD_FROM_RECIPE_ACTION = "grocery.add-from-recipe";
export const UNDO_WINDOW_MS = 10 * 60 * 1000;
export const FROM_RECIPE_MAX_INGREDIENTS = 100;
export const POSSIBLE_DUPLICATES_LIMIT = 20;
export const DEFAULT_GROCERY_LIST_NAME = "Groceries";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Exact canonical amount shown during review and persisted by recipe adds. */
export function recipeGroceryAmount(
  amount: number,
  baseServings: number,
  targetServings: number,
): number {
  return round2(amount * (targetServings / baseServings));
}
