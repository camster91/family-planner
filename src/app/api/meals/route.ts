import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { addUTCDays, parseDateOnly, startOfTodayUTC } from "@/lib/dates";
import { MEAL_INCLUDE, resolveMealLink } from "@/lib/meal-recipe-link";
import { recordBetaMetric } from "@/lib/beta-metrics";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { readD1Meals, createD1Meal, D1MealReadRefusal } from "@/lib/cloudflare/meals";
import { readIdempotencyKey } from "@/lib/idempotency";
import { createMealSchema } from "@/lib/validations";
import {
  parseMealPaging,
  encodeMealCursor,
  afterMealCursor,
} from "@/lib/meal-paging";

export const dynamic = "force-dynamic";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = (typeof MEAL_TYPES)[number];

// GET - List meals for the current family.
// Optional `start`/`end` (YYYY-MM-DD, end exclusive) select a date-only range;
// otherwise returns the next 7 days starting from today (UTC).
// Each meal carries `recipe` ({ id, title, prep_time, cook_time, servings })
// when linked (ADR-0007), else null. Several meals may share a (date,
// meal_type) slot (O-1). Opt-in limit/cursor paging returns an explicit
// continuation; old unpaged callers keep the complete plain meals response.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "meals");
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    let rangeStart = startOfTodayUTC();
    let rangeEnd = addUTCDays(rangeStart, 7);

    if (startParam !== null) {
      const parsed = parseDateOnly(startParam);
      if (!parsed) {
        return NextResponse.json(
          { error: "start must be YYYY-MM-DD" },
          { status: 400 },
        );
      }
      rangeStart = parsed;
      rangeEnd = addUTCDays(parsed, 7);
    }
    if (endParam !== null) {
      const parsed = parseDateOnly(endParam);
      if (!parsed) {
        return NextResponse.json(
          { error: "end must be YYYY-MM-DD" },
          { status: 400 },
        );
      }
      rangeEnd = parsed;
    }
    if (
      rangeEnd <= rangeStart ||
      rangeEnd.getTime() - rangeStart.getTime() > 62 * 24 * 60 * 60 * 1000
    ) {
      return NextResponse.json(
        { error: "Invalid date range" },
        { status: 400 },
      );
    }

    const scope = {
      familyId: auth.user.family_id,
      start: rangeStart,
      end: rangeEnd,
    };
    const paging = parseMealPaging(searchParams, scope);
    if (!paging.ok)
      return NextResponse.json({ error: paging.error }, { status: 400 });
    if (storageBackend() === "d1") {
      try {
        const rows = await readD1Meals(
          { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 },
          { start: rangeStart, end: rangeEnd, ...(paging.paged ? { limit: paging.limit, cursor: paging.cursor } : {}) },
        );
        const meals = paging.paged ? rows.slice(0, paging.limit) : rows;
        return NextResponse.json(
          paging.paged
            ? { meals, nextCursor: rows.length > paging.limit ? encodeMealCursor(scope, meals[meals.length - 1]) : null }
            : { meals },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (cause) {
        if (cause instanceof D1MealReadRefusal) return NextResponse.json(cause.result.body, { status: cause.result.status });
        throw cause;
      }
    }
    const rows = await prisma!.familyMeal.findMany({
      where: {
        family_id: auth.user.family_id,
        ...(paging.paged && paging.cursor
          ? afterMealCursor(paging.cursor)
          : {}),
        date: {
          gte: rangeStart,
          lt: rangeEnd,
        },
      },
      include: MEAL_INCLUDE,
      orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
      ...(paging.paged ? { take: paging.limit + 1 } : {}),
    });
    const hasMore = paging.paged && rows.length > paging.limit;
    const meals = paging.paged ? rows.slice(0, paging.limit) : rows;
    return NextResponse.json(
      paging.paged
        ? {
            meals,
            nextCursor: hasMore
              ? encodeMealCursor(scope, meals[meals.length - 1])
              : null,
          }
        : { meals },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logRouteError("GET /api/meals", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST - Create a meal slot. More than one meal per (date, meal_type) is
// allowed (ADR-0007 O-1). Optional `recipe_id` (same household) and `servings`;
// without `recipe_name` a linked meal takes the recipe title as its snapshot.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'meals')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const fields = createMealSchema.safeParse(body)
    if (!fields.success) {
      return NextResponse.json({ error: fields.error.issues[0].message }, { status: 400 })
    }
    const { recipe_name, notes, cook_id } = fields.data
    const { date, meal_type, recipe_id, servings } = body

    if (!date || !meal_type) {
      return NextResponse.json({ error: 'date and meal_type are required' }, { status: 400 })
    }

    if (!MEAL_TYPES.includes(meal_type)) {
      return NextResponse.json({ error: `meal_type must be one of: ${MEAL_TYPES.join(', ')}` }, { status: 400 })
    }

    if (storageBackend() === "d1") {
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      const result = await createD1Meal(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 },
        { date, meal_type, recipe_name, notes, cook_id, recipe_id, servings },
        key,
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store", ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}) },
      });
    }

    // Meal dates are date-only: stored as UTC midnight of the given day.
    const mealDate = parseDateOnly(date)
    if (!mealDate) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }

    // The cook must be a member of the caller's family (#102). Without this a
    // foreign user id was stored and its name echoed back through `include`.
    if (cook_id) {
      const cook = await prisma!.user.findFirst({
        where: { id: cook_id, family_id: auth.user.family_id },
        select: { id: true },
      })
      if (!cook) {
        return NextResponse.json({ error: 'Cook must be a member of your family' }, { status: 400 })
      }
    }

    const link = await resolveMealLink(prisma!, auth.user.family_id, { recipe_id, servings })
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: 400 })
    }

    const meal = await prisma!.familyMeal.create({
      data: {
        family_id: auth.user.family_id,
        date: mealDate,
        meal_type,
        recipe_name: recipe_name ?? link.recipeTitle ?? '',
        notes: notes ?? null,
        cook_id: cook_id ?? null,
        recipe_id: link.recipeId ?? null,
        servings: link.servings ?? null,
        created_by: auth.user.id,
      },
      include: MEAL_INCLUDE,
    })

    // Beta usage counts (#287): after the write; never fails the request.
    await recordBetaMetric(prisma!, auth.user.family_id, 'meal_planned')

    return NextResponse.json({ meal }, { status: 201 })
  } catch (err) {
    logRouteError('POST /api/meals', err, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
