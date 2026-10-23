import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import { mealCreateInput } from "@/lib/meal-create-contract";
import {
  authorizeMealCreate,
  createMealWithReceipt,
  confirmCreatedMeal,
  MEAL_CREATE_ACTION,
} from "@/lib/meal-create";
import { logRouteError } from "@/lib/api-error";
import { recordBetaMetric } from "@/lib/beta-metrics";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
async function handle(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const refusal = await prisma!.$transaction((tx) =>
      authorizeMealCreate(tx, actor),
    );
    if (refusal)
      return NextResponse.json(refusal.body, {
        status: refusal.status,
        headers,
      });
    if (request.method === "GET")
      return NextResponse.json(
        { userId: actor.userId, familyId: actor.familyId },
        { headers },
      );
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    if (
      !(await checkRateLimit(`meal-create:${actor.userId}`, 30, 60_000)).allowed
    )
      return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 8192));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_DRAFT",
      );
    }
    const parsed = mealCreateInput.safeParse(body);
    if (!parsed.success) return fail(400, "INVALID_DRAFT");
    if (
      parsed.data.expected_family_id !== actor.familyId ||
      parsed.data.expected_user_id !== actor.userId
    )
      return fail(403, "AUTH_CONTEXT_CHANGED");
    let createdNow = false;
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: MEAL_CREATE_ACTION,
      },
      parsed.data,
      async ({ recordId }) => {
        const result = await createMealWithReceipt(
          prisma!,
          actor,
          parsed.data,
          recordId!,
        );
        createdNow = "created" in result && result.created === true;
        return result;
      },
      {
        beforeReplay: () =>
          prisma!.$transaction((tx) => authorizeMealCreate(tx, actor)),
        transformReplay: (result) => confirmCreatedMeal(prisma!, actor, result),
      },
    );
    if (createdNow)
      await recordBetaMetric(prisma!, actor.familyId, "meal_planned");
    if (!response.ok) return response;
    const confirmation = await confirmCreatedMeal(prisma!, actor, {
      status: response.status,
      body: await response.json(),
    });
    return NextResponse.json(confirmation.body, {
      status: confirmation.status,
      headers: response.headers,
    });
  } catch (error) {
    logRouteError("meal create", error, getRequestId(request));
    return fail(500, "SAVE_UNCONFIRMED");
  }
}
export async function GET(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
export const POST = GET;
