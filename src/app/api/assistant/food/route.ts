/** Read-only canonical food preview. No provider call, meal/grocery write or purchase. */
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  foodPreviewRequest,
  previewFoodPlan,
  FoodPlanningUnavailable,
} from "@/lib/food-planning/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (
      !(await checkRateLimit(`food-preview:${auth.user.id}`, 30, 60000)).allowed
    )
      return NextResponse.json(
        { error: { code: "RATE_LIMITED" } },
        { status: 429, headers },
      );
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 16384));
    } catch (error) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST" } },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    }
    const parsed = foodPreviewRequest.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST" } },
        { status: 400, headers },
      );
    const result = await previewFoodPlan(
      storageBackend() === "d1" ? await getD1Database() : prisma!,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      },
      parsed.data,
    );
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 262144)
      throw new FoodPlanningUnavailable("SOURCE_LIMIT");
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code =
      error instanceof FoodPlanningUnavailable ? error.code : "UNAVAILABLE";
    return NextResponse.json(
      { error: { code } },
      {
        status:
          code === "FORBIDDEN" ? 403 : code === "INVALID_DATES" ? 400 : 409,
        headers,
      },
    );
  }
}
