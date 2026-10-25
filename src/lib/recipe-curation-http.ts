import { renewRecipeReadAuthority } from "@/lib/recipe-read-authority";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { featureGate } from "@/lib/feature-gate-server";
import { canEditRecipe } from "@/lib/recipes";
import {
  collectionMutation,
  recipeCurationMutation,
} from "@/lib/recipe-curation-contract";
import { mutateCollection, curateRecipe } from "@/lib/recipe-curation-server";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: NextRequest, recipeId?: string) {
  const fail = (status: number, code: string) =>
    NextResponse.json({ error: { code } }, { status, headers });
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const gate = await featureGate(auth.user.family_id, "meals");
    if (gate) return gate;
    if (recipeId && !/^[A-Za-z0-9_-]{1,128}$/.test(recipeId))
      return fail(404, "NOT_FOUND");
    if (request.method === "GET") {
      const original = Object.freeze({ actorId: auth.user.id, familyId: auth.user.family_id,
        role: auth.user.role, generation: auth.payload.tv ?? 0 });
      if (!recipeId) {
        const collections = await prisma!.recipeCollection.findMany({
          where: { family_id: auth.user.family_id },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 100,
          select: { id: true, name: true, revision: true },
        });
        const renewal = await renewRecipeReadAuthority(request, original);
        if (renewal) return renewal;
        return NextResponse.json({ collections }, { headers });
      }
      const result = await prisma!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipeId} AND "family_id" = ${auth.user.family_id} FOR SHARE`;
        const recipe = await tx.recipe.findFirst({
          where: { id: recipeId, family_id: auth.user.family_id },
          select: { id: true, revision: true, favorite: true },
        });
        if (!recipe) return null;
        const entries = await tx.recipeCollectionEntry.findMany({
          where: { recipe_id: recipeId, family_id: auth.user.family_id },
          select: { collection_id: true },
        });
        return {
          ...recipe,
          collectionIds: entries.map((entry) => entry.collection_id),
        };
      });
      const renewal = await renewRecipeReadAuthority(request, original);
      if (renewal) return renewal;
      return result
        ? NextResponse.json(result, { headers })
        : fail(404, "NOT_FOUND");
    }
    if (!canEditRecipe(auth.user.role)) return fail(403, "FORBIDDEN");
    const rate = await checkRateLimit(
      `recipe-curation:${auth.user.id}`,
      30,
      60000,
    );
    if (!rate.allowed) return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 8192));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_REQUEST",
      );
    }
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    if (recipeId) {
      const parsed = recipeCurationMutation.safeParse(body);
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      const result = await curateRecipe(prisma!, actor, recipeId, parsed.data);
      return NextResponse.json(result.body, { status: result.status, headers });
    }
    const parsed = collectionMutation.safeParse(body);
    if (!parsed.success) return fail(400, "INVALID_REQUEST");
    const result = await mutateCollection(prisma!, actor, parsed.data);
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    logRouteError("recipe curation", error, getRequestId(request));
    return fail(500, "INTERNAL_ERROR");
  }
}
export async function recipeCurationHttp(
  request: NextRequest,
  recipeId?: string,
) {
  const response = await handle(request, recipeId);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
