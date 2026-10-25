import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { renewRecipeReadAuthority } from "@/lib/recipe-read-authority";
import { featureGate } from "@/lib/feature-gate-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { fetchFeed } from "@/lib/calendar-import/fetch";
import { extractRecipeLinks, recipeSources } from "@/lib/recipe-discovery";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    source: z.enum(["all", "BBC Good Food", "Allrecipes", "Serious Eats"]),
  })
  .strict();
async function discover(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const original = Object.freeze({
    actorId: auth.user.id, familyId: auth.user.family_id,
    role: auth.user.role, generation: auth.payload.tv ?? 0,
  });
  const gate = await featureGate(auth.user.family_id, "meals");
  if (gate) return gate;
  const limit = await checkRateLimit(
    `recipe-search:${auth.user.id}`,
    15,
    60000,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Please wait a minute before searching again." },
      { status: 429 },
    );
  let body: unknown;
  try {
    body = JSON.parse(await boundedRequestText(request, 8192));
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid search." },
      { status: error instanceof RequestBodyTooLarge ? 413 : 400 },
    );
  }
  const input = inputSchema.safeParse(body);
  if (!input.success)
    return NextResponse.json(
      { error: "Choose a supported source and enter 2–120 characters." },
      { status: 400 },
    );
  const beforeFetch = await renewRecipeReadAuthority(request, original);
  if (beforeFetch) return beforeFetch;
  const selected = recipeSources.filter(
    (source) =>
      input.data.source === "all" || source.name === input.data.source,
  );
  // At most three fixed hosts. Independent bounded reads; no retry fan-out,
  // arbitrary URL, family identifier, cookie or saved household content.
  const reads = await Promise.all(
    selected.map(async (source) => {
      const searchUrl = `${source.search}${encodeURIComponent(input.data.query)}`;
      try {
        const page = await fetchFeed(searchUrl, {
          accept: "text/html",
          userAgent: "Herewoven-RecipeDiscovery/1.0",
          maxBytes: 2 * 1024 * 1024,
        });
        const results = page.notModified
          ? []
          : extractRecipeLinks(page.body, searchUrl);
        return {
          name: source.name,
          searchUrl,
          state: results.length ? ("available" as const) : ("empty" as const),
          results,
        };
      } catch {
        return {
          name: source.name,
          searchUrl,
          state: "unavailable" as const,
          results: [],
        };
      }
    }),
  );
  const afterFetch = await renewRecipeReadAuthority(request, original);
  if (afterFetch) return afterFetch;
  // Round-robin avoids filling all 24 places from the first publisher.
  const results: Array<{
    title: string;
    url: string;
    source?: (typeof recipeSources)[number]["name"];
  }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < 24 && results.length < 24; index++)
    for (const read of reads) {
      const result = read.results[index];
      if (result && !seen.has(result.url) && results.length < 24) {
        seen.add(result.url);
        results.push({
          ...result,
          ...(selected.length > 1 ? { source: read.name } : {}),
        });
      }
    }
  const unavailable = reads.every((source) => source.state === "unavailable");
  return NextResponse.json(
    {
      ...(unavailable
        ? {
            error:
              "The selected sources are unavailable. Use the original search links.",
          }
        : {}),
      results,
      source: input.data.source,
      searchUrl: selected.length === 1 ? reads[0].searchUrl : null,
      sources: reads.map(({ results: _results, ...source }) => source),
    },
    { status: unavailable ? 422 : 200 },
  );
}
export async function POST(request: NextRequest) {
  try {
    const response = await discover(request);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Recipe discovery unavailable." },
      { status: 500, headers },
    );
  }
}
