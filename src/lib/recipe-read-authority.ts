import { RECIPE_OWNER_HEADER, RECIPE_OWNER_PROTOCOL, readRecipeOwner, sameRecipeOwner } from "@/lib/recipe-owner-contract";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";

/** Server-captured context only; never take these fields from a request body. */
export type RecipeReadAuthority = Readonly<{
  actorId: string;
  familyId: string;
  role: string;
  generation: number;
}>;
/**
 * Renew the original person after body/provider/database waits. No household content query,
 * publisher retry or write is performed here; an old cookie cannot rebind work.
 * This is a point-in-time check, not a lock or cancellation of earlier traffic.
 */
export async function renewRecipeReadAuthority(
  request: NextRequest,
  original: RecipeReadAuthority,
): Promise<NextResponse | null> {
  const [current, error] = await authenticateWithFamily(request);
  if (error) return error;
  if (
    current.user.id !== original.actorId ||
    current.user.family_id !== original.familyId ||
    current.user.role !== original.role ||
    (current.payload.tv ?? 0) !== original.generation
  ) return NextResponse.json(
    { error: "Your account or household changed. Reload before using recipes again.", code: "RECIPE_SCOPE_CHANGED" },
    { status: 409 },
  );
  return featureGate(original.familyId, "meals");
}

/** Optional browser continuity claim; only compare with server-captured authority. */
export function recipeExpectedReadOwnerRefusal(request: NextRequest, original: RecipeReadAuthority): NextResponse | null {
  const expected = request.headers.get(RECIPE_OWNER_HEADER);
  if (expected === null || sameRecipeOwner(readRecipeOwner(expected), { protocol: RECIPE_OWNER_PROTOCOL, ...original })) return null;
  return NextResponse.json({ error: { code: "RECIPE_OWNER_CHANGED" } }, {
    status: 409, headers: { "Cache-Control": "private, no-store" },
  });
}
export const recipeReadOwnerHeaders = (original: RecipeReadAuthority) => ({
  "Cache-Control": "private, no-store",
  [RECIPE_OWNER_HEADER]: JSON.stringify({ protocol: RECIPE_OWNER_PROTOCOL, ...original }),
});
