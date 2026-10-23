import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  refuseInventoryReadScope,
  inventoryScopedResponse,
} from "@/lib/inventory-read-http";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { cookingReviewSource } from "@/lib/inventory-cooking-review-contract";
import { reviewCookingStock } from "@/lib/inventory-cooking-review";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    const scope = { userId: auth.user.id, familyId: auth.user.family_id };
    const refusal = refuseInventoryReadScope(request, scope);
    if (refusal) return refusal;
    if (
      !(
        await checkRateLimit(
          `inventory-cooking-review:${scope.userId}`,
          60,
          60000,
        )
      ).allowed
    )
      return fail(429, "RATE_LIMITED");
    const q = request.nextUrl.searchParams;
    if (
      [...q.keys()].some((key) => !["kind", "id", "servings"].includes(key)) ||
      [...q.keys()].some((key) => q.getAll(key).length !== 1)
    )
      return fail(400, "INVALID_COOKING_SOURCE");
    const source = cookingReviewSource.safeParse({
      kind: q.get("kind"),
      id: q.get("id"),
      ...(q.has("servings") ? { servings: Number(q.get("servings")) } : {}),
    });
    if (!source.success) return fail(400, "INVALID_COOKING_SOURCE");
    const result = await reviewCookingStock(
      prisma!,
      { ...scope, tokenVersion: auth.payload.tv ?? 0 },
      source.data,
    );
    const response = NextResponse.json(result.body, {
      status: result.status,
      headers,
    });
    return response.ok ? inventoryScopedResponse(response, scope) : response;
  } catch (error) {
    logRouteError("inventory cooking review", error, getRequestId(request));
    return fail(500, "COOKING_REVIEW_UNAVAILABLE");
  }
}
