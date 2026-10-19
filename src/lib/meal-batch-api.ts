import crypto from "node:crypto";
import {
  capturePrepRecipeHistory,
  RecipeHistoryUnavailable,
} from "@/lib/meal-recipe-history";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";
import {
  idempotencyError,
  readIdempotencyKey,
  withIdempotency,
  type EffectResult,
} from "@/lib/idempotency";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  createMealPrepSchema,
  mealPrepActionSchema,
  batchPortionCounts,
  type CreateMealPrepInput,
  type MealPrepAction,
  type MealBatchAllocation,
} from "@/lib/meal-batches";

type Actor = { userId: string; familyId: string; tokenVersion: number };
const errorMessages: Record<string, string> = {
  RECIPE_HISTORY_UNAVAILABLE:
    "The current recipe details could not be recorded. Your prep plan is kept. Review the linked recipes before marking it prepared.",
  BATCH_FULL:
    "Those portions are already planned or eaten. Reload the latest prep session.",
  STATE_CHANGED: "This plan changed elsewhere. Reload the latest prep session.",
  BEFORE_PREPARATION: "Meal dates must be on or after preparation.",
  PLANNER_FORBIDDEN: "Only parents and teens can manage prep sessions.",
  AUTH_CONTEXT_CHANGED:
    "The signed-in account or household changed. Reload before continuing.",
  PREP_NOT_READY: "Mark the session prepared before recording eaten portions.",
  NOT_ENOUGH_PORTIONS:
    "Not enough unplanned portions remain. Choose a planned meal or reload.",
};
export const batchFailure = (status: number, code: string): EffectResult => ({
  status,
  body: {
    error: {
      code,
      message:
        errorMessages[code] ??
        "This prep action is unavailable. Check your plan and try again.",
    },
  },
});
export function batchJson(result: EffectResult) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Bulk management requires verification; ordinary meal/grocery access keeps its existing role and verification policy. */
export async function authorizeMealBatchInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ordinaryMealPermissions = false,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: {
      family_id: true,
      role: true,
      token_version: true,
      email_verified: true,
    },
  });
  if (
    !user ||
    user.token_version !== actor.tokenVersion ||
    (!ordinaryMealPermissions && !user.email_verified)
  )
    return batchFailure(401, "UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !(
      ordinaryMealPermissions ? ["parent", "teen", "child"] : ["parent", "teen"]
    ).includes(user.role)
  )
    return batchFailure(403, "PLANNER_FORBIDDEN");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return batchFailure(404, "HOUSEHOLD_UNAVAILABLE");
  if (!isFeatureEnabled(normalizeFeatures(family.features), "meals"))
    return batchFailure(403, "MEALS_DISABLED");
  return null;
}

export const BATCH_MEALS_SELECT = {
  id: true,
  batch_allocation_key: true,
  date: true,
  meal_type: true,
  servings: true,
} as const;
export const BATCH_CONSUMPTION_SELECT = {
  id: true,
  meal_id: true,
  servings: true,
  consumed_at: true,
} as const;

async function addMeals(
  tx: Prisma.TransactionClient,
  actor: Actor,
  batch: {
    id: string;
    name: string;
    recipe_id: string | null;
    cook_id: string | null;
  },
  meals: readonly MealBatchAllocation[],
  restoreKey?: string,
) {
  const ids: string[] = [];
  for (const meal of meals) {
    const row = await tx.familyMeal.create({
      data: {
        family_id: actor.familyId,
        batch_id: batch.id,
        batch_allocation_key:
          restoreKey ?? `${actor.familyId}:${crypto.randomUUID()}`,
        date: parseDateOnly(meal.date)!,
        meal_type: meal.meal_type,
        recipe_name: meal.recipe_name ?? batch.name,
        recipe_id: batch.recipe_id,
        servings: meal.servings,
        cook_id: meal.cook_id !== undefined ? meal.cook_id : batch.cook_id,
        notes: meal.notes ?? null,
        created_by: actor.userId,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}
async function validCook(
  tx: Prisma.TransactionClient,
  familyId: string,
  id?: string | null,
) {
  return (
    !id ||
    Boolean(
      await tx.user.findFirst({
        where: { id, family_id: familyId },
        select: { id: true },
      }),
    )
  );
}

/** All reads/writes and the success receipt share one locked transaction. */
export async function persistMealPrepInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: CreateMealPrepInput | MealPrepAction,
  recordId: string,
): Promise<EffectResult> {
  if (
    input.expected_family_id !== actor.familyId ||
    input.expected_user_id !== actor.userId
  )
    return batchFailure(403, "AUTH_CONTEXT_CHANGED");
  const refusal = await authorizeMealBatchInTx(tx, actor);
  if (refusal) return refusal;
  await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
  const receipt = await tx.idempotencyRecord.findFirst({
    where: { id: recordId, user_id: actor.userId, family_id: actor.familyId },
    select: { response_status: true, response_body: true },
  });
  if (!receipt) return batchFailure(409, "IDEMPOTENCY_IN_PROGRESS");
  if (receipt.response_status !== null)
    return { status: receipt.response_status, body: receipt.response_body };
  let result: EffectResult;
  if ("dishes" in input) {
    for (const dish of input.dishes) {
      if (
        dish.recipe_id &&
        !(await tx.recipe.findFirst({
          where: { id: dish.recipe_id, family_id: actor.familyId },
          select: { id: true },
        }))
      )
        return batchFailure(404, "RECIPE_UNAVAILABLE");
      if (!(await validCook(tx, actor.familyId, dish.cook_id)))
        return batchFailure(400, "COOK_UNAVAILABLE");
      for (const meal of dish.meals)
        if (!(await validCook(tx, actor.familyId, meal.cook_id)))
          return batchFailure(400, "COOK_UNAVAILABLE");
    }
    const session = await tx.mealPrepSession.create({
      data: {
        family_id: actor.familyId,
        prepared_on: parseDateOnly(input.prepared_on)!,
        next_prep_on: input.next_prep_on
          ? parseDateOnly(input.next_prep_on)
          : null,
        created_by: actor.userId,
        source_request_id: recordId,
      },
      select: { id: true },
    });
    const batchIds: string[] = [],
      mealIds: string[] = [];
    for (const [position, dish] of input.dishes.entries()) {
      const batch = await tx.mealBatch.create({
        data: {
          family_id: actor.familyId,
          prep_session_id: session.id,
          position,
          name: dish.name,
          total_servings: dish.total_servings,
          reserve_storage: dish.reserve_storage,
          recipe_id: dish.recipe_id ?? null,
          cook_id: dish.cook_id ?? null,
        },
      });
      batchIds.push(batch.id);
      mealIds.push(...(await addMeals(tx, actor, batch, dish.meals)));
    }
    result = {
      status: 201,
      body: { sessionId: session.id, batchIds, mealIds },
    };
  } else if (input.action === "prepared" || input.action === "next-prep") {
    const session = await tx.mealPrepSession.findFirst({
      where: { id: input.session_id, family_id: actor.familyId },
    });
    if (!session) return batchFailure(404, "SESSION_UNAVAILABLE");
    if (input.action === "prepared") {
      if (!session.prepared_at) {
        const preparedAt = new Date();
        try {
          await capturePrepRecipeHistory(
            tx,
            actor.familyId,
            session.id,
            preparedAt,
          );
        } catch (error) {
          if (error instanceof RecipeHistoryUnavailable)
            return batchFailure(409, "RECIPE_HISTORY_UNAVAILABLE");
          throw error;
        }
        await tx.mealPrepSession.update({
          where: { id: session.id },
          data: { prepared_at: preparedAt },
        });
      }
    } else {
      const current = session.next_prep_on
        ? toDateOnlyUTC(session.next_prep_on)
        : null;
      if (current !== input.expected_next_prep_on)
        return batchFailure(409, "STATE_CHANGED");
      if (
        input.next_prep_on &&
        parseDateOnly(input.next_prep_on)! < session.prepared_on
      )
        return batchFailure(400, "BEFORE_PREPARATION");
      await tx.mealPrepSession.update({
        where: { id: session.id },
        data: {
          next_prep_on: input.next_prep_on
            ? parseDateOnly(input.next_prep_on)
            : null,
        },
      });
    }
    result = { status: 200, body: { sessionId: session.id } };
  } else if (input.action === "undo-eaten") {
    const consumption = await tx.mealBatchConsumption.findFirst({
      where: { id: input.consumption_id, family_id: actor.familyId },
    });
    if (!consumption) return batchFailure(404, "CONSUMPTION_UNAVAILABLE");
    if (!consumption.cancelled_at)
      await tx.mealBatchConsumption.update({
        where: { id: consumption.id },
        data: { cancelled_at: new Date() },
      });
    result = { status: 200, body: { consumptionId: consumption.id } };
  } else {
    const batch = await tx.mealBatch.findFirst({
      where: { id: input.batch_id, family_id: actor.familyId },
      include: {
        prep_session: true,
        meals: {
          where: { family_id: actor.familyId },
          select: BATCH_MEALS_SELECT,
        },
        consumption: {
          where: { family_id: actor.familyId, cancelled_at: null },
          select: BATCH_CONSUMPTION_SELECT,
        },
      },
    });
    if (!batch || batch.prep_session.family_id !== actor.familyId)
      return batchFailure(404, "BATCH_UNAVAILABLE");
    const counts = batchPortionCounts(
      batch.total_servings,
      batch.meals,
      batch.consumption,
    );
    if (counts.unplanned < 0) return batchFailure(409, "STATE_CHANGED");
    if (input.action === "allocate") {
      let consumedOnRestore = 0;
      if (input.restore_allocation_key) {
        if (
          input.meals.length !== 1 ||
          !input.restore_allocation_key.startsWith(`${actor.familyId}:`)
        )
          return batchFailure(404, "MEAL_UNAVAILABLE");
        if (
          await tx.familyMeal.findFirst({
            where: {
              batch_allocation_key: input.restore_allocation_key,
              family_id: actor.familyId,
            },
            select: { id: true },
          })
        )
          return batchFailure(409, "STATE_CHANGED");
        const consumed = await tx.mealBatchConsumption.aggregate({
          where: {
            allocation_key: input.restore_allocation_key,
            batch_id: batch.id,
            family_id: actor.familyId,
            cancelled_at: null,
          },
          _sum: { servings: true },
        });
        consumedOnRestore = consumed._sum.servings ?? 0;
        if (consumedOnRestore > input.meals[0].servings)
          return batchFailure(409, "STATE_CHANGED");
      }
      const requested =
        input.meals.reduce((sum, meal) => sum + meal.servings, 0) -
        consumedOnRestore;
      if (requested > counts.unplanned) return batchFailure(409, "BATCH_FULL");
      if (
        input.meals.some(
          (meal) => parseDateOnly(meal.date)! < batch.prep_session.prepared_on,
        )
      )
        return batchFailure(400, "BEFORE_PREPARATION");
      for (const meal of input.meals)
        if (!(await validCook(tx, actor.familyId, meal.cook_id)))
          return batchFailure(400, "COOK_UNAVAILABLE");
      const mealIds = await addMeals(
        tx,
        actor,
        batch,
        input.meals,
        input.restore_allocation_key,
      );
      if (input.restore_allocation_key)
        await tx.mealBatchConsumption.updateMany({
          where: {
            allocation_key: input.restore_allocation_key,
            batch_id: batch.id,
            family_id: actor.familyId,
            cancelled_at: null,
          },
          data: { meal_id: mealIds[0] },
        });
      result = { status: 201, body: { batchId: batch.id, mealIds } };
    } else {
      if (!batch.prep_session.prepared_at)
        return batchFailure(409, "PREP_NOT_READY");
      let available = counts.unplanned;
      if (input.meal_id) {
        const meal = batch.meals.find((row) => row.id === input.meal_id);
        if (!meal) return batchFailure(404, "MEAL_UNAVAILABLE");
        available =
          (meal.servings ?? 0) -
          batch.consumption
            .filter((row) => row.meal_id === meal.id)
            .reduce((n, row) => n + row.servings, 0);
      }
      if (input.servings > available || input.servings > counts.remaining)
        return batchFailure(409, "NOT_ENOUGH_PORTIONS");
      const consumption = await tx.mealBatchConsumption.create({
        data: {
          family_id: actor.familyId,
          batch_id: batch.id,
          allocation_key: input.meal_id
            ? batch.meals.find((row) => row.id === input.meal_id)
                ?.batch_allocation_key
            : null,
          meal_id: input.meal_id ?? null,
          servings: input.servings,
          created_by: actor.userId,
          source_request_id: recordId,
        },
        select: { id: true },
      });
      result = { status: 201, body: { consumptionId: consumption.id } };
    }
  }
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: result.body as Prisma.InputJsonValue,
    },
  });
  return result;
}

export async function mealPrepMutation(
  request: NextRequest,
  kind: "create" | "action",
) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (!["parent", "teen"].includes(auth.user.role))
      return batchJson(batchFailure(403, "PLANNER_FORBIDDEN"));
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return batchJson(batchFailure(400, "INVALID_DRAFT"));
    }
    const parsed =
      kind === "create"
        ? createMealPrepSchema.safeParse(body)
        : mealPrepActionSchema.safeParse(body);
    if (!parsed.success) return batchJson(batchFailure(400, "INVALID_DRAFT"));
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    if (
      parsed.data.expected_family_id !== actor.familyId ||
      parsed.data.expected_user_id !== actor.userId
    )
      return batchJson(batchFailure(403, "AUTH_CONTEXT_CHANGED"));
    const action = "action" in parsed.data ? parsed.data.action : "create";
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: `meal-prep.${action}`,
      },
      parsed.data,
      ({ recordId }) =>
        prisma!.$transaction(
          (tx) => persistMealPrepInTx(tx, actor, parsed.data, recordId!),
          { timeout: 15000 },
        ),
      {
        beforeReplay: () =>
          prisma!.$transaction((tx) => authorizeMealBatchInTx(tx, actor)),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    logRouteError(`meal-prep.${kind}`, error, getRequestId(request));
    return batchJson(batchFailure(500, "SAVE_UNCONFIRMED"));
  }
}
