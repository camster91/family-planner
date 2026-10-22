/** Strict person/owner-bound save and read-only receipt inspection. */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "../api-auth";
import { prisma } from "../prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "../bounded-request-text";
import { checkRateLimit } from "../rate-limit-db";
import {
  idempotencyError,
  readIdempotencyKey,
  withIdempotency,
  type EffectResult,
} from "../idempotency";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
  type ReviewedFoodWrite,
} from "./apply-contract";
import {
  authorizeFoodWriteInTx,
  persistReviewedFoodPlan,
  FoodWriteRefused,
} from "./persist";
import { createFoodWriteSourceGuard } from "./review";
import { readFoodReviewSeal, FoodReviewRefused } from "./review-proof";
import { FoodPlanningUnavailable, type FoodPlanActor } from "./server";
import { foodRequestOwner, foodWritingEnabled } from "./owner";
import {
  foodSourceStorageAvailable,
  FoodSourceVersionsUnavailable,
} from "./source-versions";
import {
  FOOD_RECOVERY,
  FOOD_OWNER_HEADER,
  FOOD_BODY_MAX_BYTES,
  foodRecoveryContext,
  foodRecoveryInput,
  foodRecoveryKey,
} from "./recovery-contract";
import { inspectFoodRequest } from "./recovery-server";
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
function knownFailure(error: unknown): EffectResult | null {
  if (error instanceof FoodWriteRefused) return error.result;
  if (error instanceof FoodSourceVersionsUnavailable)
    return failure(409, "UNAVAILABLE");
  if (error instanceof FoodReviewRefused) return failure(409, error.code);
  if (error instanceof FoodPlanningUnavailable)
    return failure(error.code === "FORBIDDEN" ? 403 : 409, error.code);
  if (error instanceof RequestBodyTooLarge)
    return failure(413, "INVALID_REQUEST");
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return failure(400, "INVALID_REQUEST");
  return null;
}
const json = (result: EffectResult) =>
  NextResponse.json(result.body, { status: result.status, headers });
async function authorize(actor: FoodPlanActor, command?: ReviewedFoodWrite) {
  return prisma!.$transaction((tx) =>
    authorizeFoodWriteInTx(tx, actor, command),
  );
}
export async function handleFoodHttp(
  request: NextRequest,
  mode: "context" | "apply" | "inspect",
) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!prisma) return json(failure(409, "UNAVAILABLE"));
    const actor: FoodPlanActor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    // Do not reserve keys, read receipts or return private pointers first.
    const current = await authorize(actor);
    const owner = foodRequestOwner(request, auth.payload, actor);
    if (
      !(
        await checkRateLimit(
          `food-${mode}:${actor.userId}`,
          mode === "context" ? 120 : mode === "inspect" ? 60 : 20,
          60000,
        )
      ).allowed
    )
      return json(failure(429, "RATE_LIMITED"));
    if (mode === "context")
      return NextResponse.json(
        foodRecoveryContext.parse({
          contract: FOOD_RECOVERY,
          enabled:
            owner !== null &&
            current.inventoryEnabled &&
            foodWritingEnabled() &&
            (await foodSourceStorageAvailable(prisma)),
          owner,
          userId: actor.userId,
          familyId: actor.familyId,
          role: actor.role,
        }),
        { headers },
      );
    if (!owner || request.headers.get(FOOD_OWNER_HEADER) !== owner.scope)
      return json(failure(403, "AUTH_CONTEXT_CHANGED"));
    if (mode === "inspect") {
      const input = foodRecoveryInput.parse(
        JSON.parse(await boundedRequestText(request, 196608)),
      );
      const result = await inspectFoodRequest(
        prisma,
        actor,
        input.entry,
        owner.scope,
      );
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 262144)
        return json(failure(409, "UNAVAILABLE"));
      return NextResponse.json(result, { headers });
    }
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) {
      keyError.headers.set("Cache-Control", "private, no-store");
      return keyError;
    }
    if (!key) {
      const response = idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (!foodRecoveryKey.safeParse(key).success)
      return json(failure(400, "INVALID_REQUEST"));
    const command = reviewedFoodWrite.parse(
      JSON.parse(await boundedRequestText(request, FOOD_BODY_MAX_BYTES)),
    );
    readFoodReviewSeal(actor, command); // Original owner/command, no fresh-source requirement for replay.
    // Do not gate completed receipt replay on readiness, source lease or targets.
    const response = await withIdempotency(
      prisma,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: FOOD_APPLY_ACTION,
      },
      command,
      async ({ recordId }) => {
        if (!recordId) throw new FoodReviewRefused();
        if (!foodWritingEnabled()) return failure(409, "FOOD_WRITING_PAUSED");
        return persistReviewedFoodPlan(
          prisma!,
          actor,
          command,
          recordId,
          createFoodWriteSourceGuard(),
        );
      },
      {
        beforeReplay: async () => {
          try {
            await authorize(actor, command);
            readFoodReviewSeal(actor, command);
            return null;
          } catch (error) {
            return knownFailure(error) ?? failure(409, "UNAVAILABLE");
          }
        },
        transformReplay: (result) =>
          result.status === 201 && foodApplyReceiptMatches(result.body, command)
            ? { status: 201, body: foodApplyReceipt.parse(result.body) }
            : failure(409, "RECEIPT_UNAVAILABLE"),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    // A transport/transaction failure does not establish that no effect committed.
    return json(
      knownFailure(error) ??
        failure(
          mode === "apply" ? 500 : 409,
          mode === "apply" ? "SAVE_UNCONFIRMED" : "UNAVAILABLE",
        ),
    );
  }
}
