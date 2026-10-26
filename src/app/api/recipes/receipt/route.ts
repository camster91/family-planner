import { recipeOwnerSchema, sameRecipeOwner, RECIPE_OWNER_PROTOCOL } from "@/lib/recipe-owner-contract";
import { recipeExpectedReadOwnerRefusal, recipeReadOwnerHeaders } from "@/lib/recipe-read-authority";
import { foodSourceStorageAvailable } from "@/lib/food-planning/source-versions";
import { readRecipeCreateReceiptIdentity } from "@/lib/recipe-create-receipt-identity";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import { authorizeRecipeCreation, recipeWriteAuthority, RECIPE_CREATE_ACTION } from "@/lib/recipe-write";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200, ownerHeaders: Record<string, string> = {}) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...ownerHeaders },
  });

/** State-only canonical create receipt. No cached private recipe/title/source
 * is returned, and no receipt is created, refreshed, pruned or replayed.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const actor = Object.freeze({ userId: auth.user.id, familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0, originalRole: auth.user.role });
    const original = { actorId: actor.userId, familyId: actor.familyId, role: actor.originalRole, generation: actor.tokenVersion };
    const ownerRefusal = recipeExpectedReadOwnerRefusal(request, original);
    if (ownerRefusal) return ownerRefusal;
    const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const hash = request.headers.get("X-Recipe-Request-Hash") ?? "";
    if (!isValidIdempotencyKey(key) || !/^[a-f0-9]{64}$/.test(hash))
      return reply({ error: "Invalid recipe receipt headers" }, 400);
    const result = await prisma!.$transaction(async (tx) => {
      const refusal = await recipeWriteAuthority(tx, actor);
      if (refusal) return refusal;
      const scope = `user:${actor.userId}`;
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "scope" = ${scope} AND "key" = ${key}
        AND "family_id" = ${actor.familyId} AND "user_id" = ${actor.userId} FOR SHARE`;
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope, key, family_id: actor.familyId, user_id: actor.userId },
        select: {
          family_id: true,
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
          expires_at: true,
        },
      });
      if (!record || record.family_id !== auth.user.family_id)
        return { status: 200, body: { state: "absent" } };
      if (
        record.action !== RECIPE_CREATE_ACTION ||
        record.request_hash !== hash
      )
        return {
          status: 409,
          body: { error: { code: "RECIPE_RECEIPT_CONFLICT" } },
        };
      if (record.expires_at.getTime() <= Date.now())
        return { status: 200, body: { state: "expired" } };
      if (record.response_status === null)
        return { status: 200, body: { state: "pending" } };
      const body = record.response_body;
      if (body && typeof body === "object" && !Array.isArray(body) && "creationOwner" in body) {
        const commandOwner = recipeOwnerSchema.safeParse(body.creationOwner);
        if (!commandOwner.success || !sameRecipeOwner(commandOwner.data, { protocol: RECIPE_OWNER_PROTOCOL, ...original }))
          return { status: 409, body: { error: { code: "RECIPE_OWNER_CHANGED" } } };
      }
      if (
        record.response_status === 409 &&
        body &&
        typeof body === "object" &&
        !Array.isArray(body)
      ) {
        const error = body.error;
        const code =
          error && typeof error === "object" && !Array.isArray(error)
            ? error.code
            : null;
        if (
          code === "RECIPE_SOURCE_EXISTS" ||
          code === "RECIPE_SOURCE_CHECK_UNAVAILABLE"
        )
          return {
            status: 200,
            body: {
              state: "refused",
              reason:
                code === "RECIPE_SOURCE_EXISTS"
                  ? "source-exists"
                  : "source-check-unavailable",
            },
          };
      }
      const identity = readRecipeCreateReceiptIdentity(body);
      if (!identity) return { status: 200, body: { state: "committed", current: "unknown" } };
      if (!(await foodSourceStorageAvailable(tx))) return { status: 503, body: { error: { code: "RECIPE_IDENTITY_UNAVAILABLE" } } };
      const matches = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Recipe"
        WHERE "id" = ${identity.recipeId} AND "family_id" = ${actor.familyId} AND "created_by" = ${actor.userId}
        AND "food_generation" = ${identity.recipeGeneration} FOR SHARE`;
      const present = matches.length === 1 && matches[0].id === identity.recipeId;
      return {
        status: 200,
        body: {
          state: "committed",
          current: present ? "present" : "removed",
        },
      };
    }, { timeout: 5000, maxWait: 5000 });
    if (result.status === 200) {
      const refusal = await authorizeRecipeCreation(prisma!, actor);
      if (refusal) return reply(refusal.body, refusal.status);
    }
    return reply(result.body, result.status, result.status === 200 ? recipeReadOwnerHeaders(original) : {});
  } catch (error) {
    logRouteError("GET recipe receipt", error, getRequestId(request));
    return reply({ error: "Recipe receipt unavailable" }, 500);
  }
}
