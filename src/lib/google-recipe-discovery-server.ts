import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { storageBackend } from "./storage-backend";
import { getD1Database } from "./cloudflare/database";
import { resolveCaptureConfig, type CaptureSettingsRow } from "./capture";
import { approvedGoogleRecipePricing } from "./google-recipe-search-config";
import { searchGoogleRecipes } from "./google-recipe-search";
import {
  createAiUsageJob,
  AiUsageError,
  type AiUsageJob,
} from "./ai-usage-server";
import {
  renewRecipeReadAuthority,
  recipeReadOwnerHeaders,
  type RecipeReadAuthority,
} from "./recipe-read-authority";
import { refusePairedDevice } from "./device-route";
import { geminiProviderApproved } from "./gemini-policy";

export async function discoverGoogleRecipes(
  request: NextRequest,
  original: RecipeReadAuthority,
  query: string,
) {
  let meter: AiUsageJob = undefined;
  const failure = (status: number, error: string) =>
    NextResponse.json(
      { error },
      { status, headers: recipeReadOwnerHeaders(original) },
    );
  // #144: fall back to the fixed recipe sources while Gemini is off.
  if (!geminiProviderApproved()) return null;
  try {
    const paired = await refusePairedDevice(request);
    if (paired) return paired;
    if (!["parent", "teen"].includes(original.role))
      return failure(
        403,
        "Google recipe discovery requires a personal parent or teen account.",
      );
    const d1 = storageBackend() === "d1" ? await getD1Database() : null;
    const database = storageBackend() === "d1" ? d1 : prisma;
    if (!database)
      return failure(503, "Recipe search is unavailable. Try a recipe link.");
    const family = d1
      ? await d1
          .withSession("first-primary")
          .prepare(
            'SELECT capture_ai_key_enc,capture_ai_base_url,capture_ai_model FROM "Family" WHERE id=?1',
          )
          .bind(original.familyId)
          .first<CaptureSettingsRow>()
      : await prisma!.family.findUnique({
          where: { id: original.familyId },
          select: {
            capture_ai_key_enc: true,
            capture_ai_base_url: true,
            capture_ai_model: true,
          },
        });
    const config = resolveCaptureConfig(family);
    if (!config || !["https://generativelanguage.googleapis.com/v1beta", "https://generativelanguage.googleapis.com/v1beta/openai"].includes(config.baseUrl)) return null;
    const pricing = approvedGoogleRecipePricing(config);
    if (!family || !config || !pricing)
      return failure(
        503,
        "Google recipe search needs verified configuration and pricing. You can still paste a recipe link.",
      );
    const before = await renewRecipeReadAuthority(request, original);
    if (before) return before;
    meter = createAiUsageJob(
      database,
      {
        userId: original.actorId,
        familyId: original.familyId,
        role: original.role,
        generation: original.generation,
      },
      config,
      "assistant",
    );
    if (!meter)
      return failure(503, "Recipe search usage limits are unavailable.");
    const grounded = await searchGoogleRecipes(
      query,
      config,
      pricing,
      meter.observer,
    );
    if (
      !(await meter.replyAllowed()) ||
      JSON.stringify(approvedGoogleRecipePricing(config)) !==
        JSON.stringify(pricing)
    ) {
      await meter.finish(409);
      return failure(
        409,
        "Recipe search settings changed. Please search again.",
      );
    }
    const after = await renewRecipeReadAuthority(request, original);
    if (after) {
      await meter.finish(after.status);
      return after;
    }
    await meter.finish(200);
    const final = await renewRecipeReadAuthority(request, original);
    if (final) return final;
    return NextResponse.json(
      { results: [], source: "Google", grounded },
      { headers: recipeReadOwnerHeaders(original) },
    );
  } catch (error) {
    const status = error instanceof AiUsageError ? error.status : 502;
    await meter?.finish(status);
    return failure(
      status,
      error instanceof AiUsageError
        ? error.message
        : "Google recipe search is unavailable. Try another source or paste a recipe link.",
    );
  }
}
