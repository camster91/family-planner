/** Explicit metered read suggestion. Never reserves a meal/grocery write key. */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  createAiUsageJob,
  AiUsageError,
  type AiUsageJob,
} from "@/lib/ai-usage-server";
import { CaptureError, resolveCaptureConfig } from "@/lib/capture";
import { normalizeFeatures } from "@/lib/features";
import { foodRequestOwner } from "@/lib/food-planning/owner";
import { FOOD_OWNER_HEADER } from "@/lib/food-planning/recovery-contract";
import { foodAiEnabled } from "@/lib/food-planning/ai-gates";
import {
  FoodAiRefused,
  foodAiLeaseCurrent,
} from "@/lib/food-planning/ai-catalog";
import {
  foodAiFamilySelect,
  suggestFoodPlan,
} from "@/lib/food-planning/ai-server";
import { FoodPlanningUnavailable } from "@/lib/food-planning/server";
import { foodAiRequest } from "@/lib/food-planning/ai-contract";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
export async function POST(request: NextRequest) {
  let meter: AiUsageJob = undefined;
  try {
    const paired = await refusePairedDevice(request);
    if (paired) {
      paired.headers.set("Cache-Control", "private, no-store");
      return paired;
    }
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!prisma || !foodAiEnabled()) return failure(503, "FOOD_AI_PAUSED");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    const owner = foodRequestOwner(request, auth.payload, actor);
    if (
      !owner ||
      !["parent", "teen"].includes(actor.role) ||
      request.headers.get(FOOD_OWNER_HEADER) !== owner.scope
    )
      return failure(403, "AUTH_CONTEXT_CHANGED");
    if (!(await checkRateLimit(`food-ai:${actor.userId}`, 10, 3600000)).allowed)
      return failure(429, "RATE_LIMITED");
    const input = foodAiRequest.parse(
      JSON.parse(await boundedRequestText(request, 32768)),
    );
    const family = await prisma.family.findUnique({
      where: { id: actor.familyId },
      select: foodAiFamilySelect,
    });
    const config = resolveCaptureConfig(family);
    if (!family || !config) return failure(503, "AI_PROVIDER_NOT_CONFIGURED");
    // Deliberately the existing assistant usage bucket, with no new content log
    // or unmetered fallback. The transport observer reserves before dispatch.
    meter = createAiUsageJob(prisma, actor, config, "assistant");
    if (!meter) return failure(503, "FOOD_AI_PAUSED");
    const renewAuthentication = async () => {
      const [renewed, denied] = await authenticateWithFamily(request);
      return (
        !denied &&
        renewed.user.id === actor.userId &&
        renewed.user.family_id === actor.familyId &&
        renewed.user.role === actor.role &&
        (renewed.payload.tv ?? 0) === actor.generation
      );
    };
    const suggestion = await suggestFoodPlan(
      prisma,
      actor,
      input,
      config,
      normalizeFeatures(family.features),
      meter,
      renewAuthentication,
    );
    if (
      !foodAiEnabled() ||
      !foodAiLeaseCurrent(suggestion.original) ||
      !(await meter.replyAllowed())
    ) {
      await meter.finish(409);
      return failure(409, "AI_SOURCE_CHANGED");
    }
    await meter.finish(200);
    if (
      !foodAiEnabled() ||
      !foodAiLeaseCurrent(suggestion.original) ||
      !(await renewAuthentication())
    )
      return failure(409, "AI_SOURCE_CHANGED");
    return NextResponse.json(suggestion, { headers });
  } catch (error) {
    const status =
      error instanceof RequestBodyTooLarge
        ? 413
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof AiUsageError || error instanceof CaptureError
            ? error.status
            : 409;
    await meter?.finish(status);
    const code =
      error instanceof FoodAiRefused ||
      error instanceof FoodPlanningUnavailable ||
      error instanceof AiUsageError
        ? error.code
        : status === 400 || status === 413
          ? "INVALID_REQUEST"
          : "FOOD_AI_UNAVAILABLE";
    return failure(status, code);
  }
}
