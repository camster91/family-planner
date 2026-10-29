import {
  RECIPE_OWNER_HEADER,
  RECIPE_OWNER_PROTOCOL,
  readRecipeOwner,
  sameRecipeOwner,
} from "@/lib/recipe-owner-contract";
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
import { storageBackend } from "@/lib/storage-backend";
import {
  readD1Collections,
  readD1Curation,
  mutateD1Collection,
  mutateD1Curation,
} from "@/lib/cloudflare/recipe-library";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: NextRequest, recipeId?: string) {
  const fail = (status: number, code: string) =>
    NextResponse.json({ error: { code } }, { status, headers });
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const original = Object.freeze({
      actorId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    });
    const originalOwner = {
      protocol: RECIPE_OWNER_PROTOCOL,
      ...original,
    } as const;
    const expectedOwner = request.headers.get(RECIPE_OWNER_HEADER);
    if (
      expectedOwner !== null &&
      !sameRecipeOwner(readRecipeOwner(expectedOwner), originalOwner)
    )
      return fail(409, "RECIPE_OWNER_CHANGED");
    const ownedHeaders = {
      ...headers,
      [RECIPE_OWNER_HEADER]: JSON.stringify(originalOwner),
    };
    const gate = await featureGate(auth.user.family_id, "meals");
    if (gate) return gate;
    if (recipeId && !/^[A-Za-z0-9_-]{1,128}$/.test(recipeId))
      return fail(404, "NOT_FOUND");
    if (request.method === "GET") {
      if (storageBackend() === "d1") {
        const native = recipeId
          ? await readD1Curation(
              {
                userId: original.actorId,
                familyId: original.familyId,
                role: original.role,
                generation: original.generation,
              },
              recipeId,
            )
          : await readD1Collections({
              userId: original.actorId,
              familyId: original.familyId,
              role: original.role,
              generation: original.generation,
            });
        const renewal = await renewRecipeReadAuthority(request, original);
        if (renewal) return renewal;
        return NextResponse.json(native.body, {
          status: native.status,
          headers: ownedHeaders,
        });
      }
      if (!recipeId) {
        const collections = await prisma!.recipeCollection.findMany({
          where: { family_id: auth.user.family_id },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 100,
          select: { id: true, name: true, revision: true },
        });
        const renewal = await renewRecipeReadAuthority(request, original);
        if (renewal) return renewal;
        return NextResponse.json({ collections }, { headers: ownedHeaders });
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
        ? NextResponse.json(result, { headers: ownedHeaders })
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
      if (storageBackend() === "d1") {
        const result = await mutateD1Curation(
          {
            userId: original.actorId,
            familyId: original.familyId,
            role: original.role,
            generation: original.generation,
          },
          recipeId,
          parsed.data,
        );
        const renewal = await renewRecipeReadAuthority(request, original);
        if (renewal) return renewal;
        return NextResponse.json(result.body, {
          status: result.status,
          headers: ownedHeaders,
        });
      }
      const result = await curateRecipe(prisma!, actor, recipeId, parsed.data);
      const renewal = await renewRecipeReadAuthority(request, original);
      if (renewal) return renewal;
      return NextResponse.json(result.body, {
        status: result.status,
        headers: ownedHeaders,
      });
    }
    const parsed = collectionMutation.safeParse(body);
    if (!parsed.success) return fail(400, "INVALID_REQUEST");
    if (storageBackend() === "d1") {
      const result = await mutateD1Collection(
        {
          userId: original.actorId,
          familyId: original.familyId,
          role: original.role,
          generation: original.generation,
        },
        parsed.data,
      );
      const renewal = await renewRecipeReadAuthority(request, original);
      if (renewal) return renewal;
      return NextResponse.json(result.body, {
        status: result.status,
        headers: ownedHeaders,
      });
    }
    const result = await mutateCollection(prisma!, actor, parsed.data);
    const renewal = await renewRecipeReadAuthority(request, original);
    if (renewal) return renewal;
    return NextResponse.json(result.body, {
      status: result.status,
      headers: ownedHeaders,
    });
  } catch (error) {
    if (error instanceof D1PersonReceiptError) return fail(409, error.code);
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
