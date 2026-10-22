import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import { recipeWriteAuthority, RECIPE_CREATE_ACTION } from "@/lib/recipe-write";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
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
    const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const hash = request.headers.get("X-Recipe-Request-Hash") ?? "";
    if (!isValidIdempotencyKey(key) || !/^[a-f0-9]{64}$/.test(hash))
      return reply({ error: "Invalid recipe receipt headers" }, 400);
    const result = await prisma!.$transaction(async (tx) => {
      const refusal = await recipeWriteAuthority(tx, {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      });
      if (refusal) return refusal;
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope: `user:${auth.user.id}`, key },
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
      const id =
        body && typeof body === "object" && !Array.isArray(body)
          ? body.recipeId
          : null;
      if (typeof id !== "string" || !id)
        return {
          status: 200,
          body: { state: "committed", current: "unknown" },
        };
      const recipe = await tx.recipe.findFirst({
        where: { id, family_id: auth.user.family_id },
        select: { id: true },
      });
      return {
        status: 200,
        body: {
          state: "committed",
          current: recipe ? "present" : "removed",
        },
      };
    });
    return reply(result.body, result.status);
  } catch (error) {
    logRouteError("GET recipe receipt", error, getRequestId(request));
    return reply({ error: "Recipe receipt unavailable" }, 500);
  }
}
