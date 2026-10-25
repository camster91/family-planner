import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body";
import { RECIPE_WRITE_MAX_BYTES } from "@/lib/recipe-input-contract";
import { REVIEW_SUBMIT_HEADERS } from "@/lib/review-document-submit-contract";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import {
  RECIPE_SUMMARY_SELECT,
  RecipeInputError,
  canEditRecipe,
  createRecipeSchema,
} from "@/lib/recipes";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  idempotencyError,
  readIdempotencyKey,
  withIdempotency,
} from "@/lib/idempotency";
import {
  RECIPE_CREATE_ACTION,
  authorizeRecipeCreation,
  createRecipeWithReceipt,
  readCreatedRecipe,
} from "@/lib/recipe-write";
import { recipeSearchSchema, recipeSearchWhere } from "@/lib/recipe-search";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002",
  );
}

// GET /api/recipes?limit=&offset= — the household's recipes (summary fields),
// ordered by title. Every role may read (O-7).
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "meals");
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const offsetRaw = searchParams.get("offset");
    const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
    const offset = offsetRaw === null ? 0 : Number(offsetRaw);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      return NextResponse.json(
        { error: `limit must be 1-${MAX_LIMIT} and offset >= 0` },
        { status: 400 },
      );
    }

    const search = recipeSearchSchema.safeParse(
      Object.fromEntries(
        [
          "q",
          "ingredient",
          "maxPrep",
          "minServings",
          "favorite",
          "collection",
        ].flatMap((key) =>
          searchParams.has(key) ? [[key, searchParams.get(key)]] : [],
        ),
      ),
    );
    if (!search.success)
      return NextResponse.json(
        { error: "Invalid recipe search filters" },
        { status: 400 },
      );
    const rows = await prisma!.recipe.findMany({
      where: recipeSearchWhere(auth.user.family_id, search.data),
      select: {
        ...RECIPE_SUMMARY_SELECT,
        _count: { select: { ingredients: true } },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const recipes = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json(
      { recipes, nextOffset: hasMore ? offset + limit : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logRouteError("GET /api/recipes", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/recipes — parent or teen (O-7). Nested ingredients are resolved
// in the caller's household only (src/lib/recipes.ts).
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const reviewRefusal = guardReviewDocumentSubmission(
      request,
      auth,
      "recipe.create",
    );
    if (reviewRefusal) return reviewRefusal;

    const gate = await featureGate(auth.user.family_id, "meals");
    if (gate) return gate;

    if (!canEditRecipe(auth.user.role)) {
      return NextResponse.json(
        { error: "Ask a parent or teen to add a recipe." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request, RECIPE_WRITE_MAX_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError)
        return NextResponse.json(
          { error: { code: "RECIPE_REQUEST_TOO_LARGE" } },
          { status: 413, headers: { "Cache-Control": "private, no-store" } },
        );
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createRecipeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (data.creation_protocol && !key)
      return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: RECIPE_CREATE_ACTION,
      },
      data,
      ({ recordId }) =>
        createRecipeWithReceipt(
          prisma!,
          actor,
          data,
          recordId,
          request.headers.has(REVIEW_SUBMIT_HEADERS.contract),
        ),
      {
        beforeReplay: () => authorizeRecipeCreation(prisma!, actor),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    if (!response.ok) return response;
    const receipt = (await response.json()) as { recipeId?: unknown };
    if (typeof receipt.recipeId !== "string")
      return NextResponse.json(
        { error: "Recipe confirmation unavailable" },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    const detail = await readCreatedRecipe(prisma!, actor, receipt.recipeId);
    return NextResponse.json(detail.body, {
      status: detail.status === 200 ? response.status : detail.status,
      headers: response.headers,
    });
  } catch (err) {
    if (err instanceof RecipeInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "The recipe changed at the same time. Please try again." },
        { status: 409 },
      );
    }
    logRouteError("POST /api/recipes", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
