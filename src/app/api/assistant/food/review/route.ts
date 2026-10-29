/** Person-only read review. This endpoint never dispatches an effect. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { reviewD1FoodPlanWrite } from "@/lib/cloudflare/food-planning";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { FoodPlanningUnavailable } from "@/lib/food-planning/server";
import { FoodReviewRefused } from "@/lib/food-planning/review-proof";
import { reviewFoodPlanWrite } from "@/lib/food-planning/review";
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
      !(await checkRateLimit(`food-review:${auth.user.id}`, 30, 60000)).allowed
    )
      return NextResponse.json(
        { error: { code: "RATE_LIMITED" } },
        { status: 429, headers },
      );
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 65536));
    } catch (error) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST" } },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    }
    const result = await (storageBackend() === "d1"
      ? reviewD1FoodPlanWrite(
          await getD1Database(),
          {
            userId: auth.user.id,
            familyId: auth.user.family_id,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          },
          body,
        )
      : reviewFoodPlanWrite(
          prisma!,
          {
            userId: auth.user.id,
            familyId: auth.user.family_id,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          },
          body,
        ));
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 262144)
      throw new FoodPlanningUnavailable("SOURCE_LIMIT");
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "INVALID_REQUEST"
        : error instanceof FoodPlanningUnavailable ||
            error instanceof FoodReviewRefused
          ? error.code
          : "UNAVAILABLE";
    return NextResponse.json(
      { error: { code } },
      {
        status:
          code === "FORBIDDEN"
            ? 403
            : ["INVALID_REQUEST", "INVALID_DATES"].includes(code)
              ? 400
              : 409,
        headers,
      },
    );
  }
}
