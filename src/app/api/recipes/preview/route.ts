import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { renewRecipeReadAuthority } from "@/lib/recipe-read-authority";
import { featureGate } from "@/lib/feature-gate-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { canEditRecipe } from "@/lib/recipes";
import { fetchFeed } from "@/lib/calendar-import/fetch";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { z } from "zod";
import { extractOnlineRecipe, publicRecipeUrl } from "@/lib/recipe-discovery";

export const runtime = "nodejs";
async function preview(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const original = Object.freeze({
    actorId: auth.user.id, familyId: auth.user.family_id,
    role: auth.user.role, generation: auth.payload.tv ?? 0,
  });
  const gate = await featureGate(auth.user.family_id, "meals");
  if (gate) return gate;
  if (!canEditRecipe(auth.user.role))
    return NextResponse.json(
      { error: "Ask a parent or teen to import a recipe." },
      { status: 403 },
    );
  const limit = await checkRateLimit(
    `recipe-preview:${auth.user.id}`,
    15,
    60000,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Please wait a minute before importing another recipe." },
      { status: 429 },
    );
  let body: unknown;
  try {
    body = JSON.parse(await boundedRequestText(request, 8192));
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid recipe link." },
      { status: error instanceof RequestBodyTooLarge ? 413 : 400 },
    );
  }
  const input = z
    .object({ url: z.string().max(1500) })
    .strict()
    .safeParse(body);
  const url = input.success ? publicRecipeUrl(input.data.url) : null;
  if (!url)
    return NextResponse.json(
      { error: "Use a public HTTPS recipe link." },
      { status: 400 },
    );
  const beforeFetch = await renewRecipeReadAuthority(request, original);
  if (beforeFetch) return beforeFetch;
  try {
    // Shared transport pins public DNS addresses, validates each redirect,
    // caps response bytes and enforces a timeout. No cookies or credentials.
    const page = await fetchFeed(url, {
      accept: "text/html",
      userAgent: "Herewoven-RecipePreview/1.0",
      maxBytes: 2 * 1024 * 1024,
    });
    const afterFetch = await renewRecipeReadAuthority(request, original);
    if (afterFetch) return afterFetch;
    const recipe = page.notModified
      ? null
      : extractOnlineRecipe(page.body, url);
    if (!recipe)
      return NextResponse.json(
        {
          error:
            "No readable recipe found. Open the original or add the recipe manually.",
        },
        { status: 422 },
      );
    return NextResponse.json(
      { recipe },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "This recipe could not be read. Open the original or try another public recipe link.",
      },
      { status: 422 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const response = await preview(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Recipe preview unavailable." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
