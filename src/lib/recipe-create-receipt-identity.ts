/** Exact recipe insertion pointer; legacy ID-only receipts cannot prove birth. */
export function readRecipeCreateReceiptIdentity(value: unknown): { recipeId: string; recipeGeneration: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.recipeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(row.recipeId) &&
    typeof row.recipeGeneration === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.recipeGeneration)
    ? { recipeId: row.recipeId, recipeGeneration: row.recipeGeneration } : null;
}
