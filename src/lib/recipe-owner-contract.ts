import { z } from "zod";
export const RECIPE_OWNER_HEADER = "X-Herewoven-Recipe-Owner";
export const RECIPE_OWNER_PROTOCOL = "herewoven.recipe-owner.v1";
const owner = z.object({ protocol: z.literal(RECIPE_OWNER_PROTOCOL),
  actorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  familyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  role: z.string().min(1).max(32), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type RecipeOwner = z.infer<typeof owner>;
export function readRecipeOwner(value: string | null): RecipeOwner | null {
  if (!value || value.length > 1024) return null;
  try { const parsed = owner.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
export function sameRecipeOwner(a: RecipeOwner | null, b: RecipeOwner | null): boolean {
  return Boolean(a && b && a.actorId === b.actorId && a.familyId === b.familyId && a.role === b.role && a.generation === b.generation);
}
