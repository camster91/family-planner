/** Canonical write composition only. No route or provider may call this without
 * the concrete reviewed-source guard; that guard must bind the entire command,
 * renew all food/calendar evidence and enforce its original observation lease.
 * Do not return a failure from inside the transaction after the first effect. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { lockUser, lockHousehold } from "../household-lock";
import { normalizeFeatures, isFeatureEnabled } from "../features";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_MAX_BODY_CHARS,
  type EffectResult,
} from "../idempotency";
import { mealCreateReceipt } from "../meal-create-contract";
import { createMealWithReceiptInTx, MEAL_CREATE_ACTION } from "../meal-create";
import { persistMealPrepInTx } from "../meal-batch-api";
import {
  ADD_FROM_RECIPE_ACTION,
  addFromRecipeSchema,
  addRecipeToGroceriesInTx,
} from "../grocery-from-recipe";
import { foodPlanningEnabled, type FoodPlanActor } from "./server";

import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  type ReviewedFoodWrite,
  type FoodApplyReceipt,
} from "./apply-contract";
export {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  type ReviewedFoodWrite,
  type FoodApplyReceipt,
} from "./apply-contract";
/** Required dependency, never optional/fallback. Verification runs in the same
 * transaction before any child write. assertCurrent checks only lease/rollout
 * at the last write boundary; own meal writes must not invalidate their source. */
export interface FoodWriteSourceGuard {
  verify(
    tx: Prisma.TransactionClient,
    actor: FoodPlanActor,
    input: ReviewedFoodWrite,
  ): Promise<void>;
  assertCurrent(): void;
}
export class FoodWriteRefused extends Error {
  constructor(readonly result: EffectResult) {
    super("Food plan save refused");
  }
}
function refuse(status: number, code: string): never {
  throw new FoodWriteRefused({ status, body: { error: { code } } });
}
function success(result: EffectResult) {
  if (result.status < 200 || result.status >= 300)
    throw new FoodWriteRefused(result);
  return result.body;
}
/** Also used for receipt inspection: current original person/role/generation and
 * Meals permission are required, even when rollout is paused or sources expired. */
export async function authorizeFoodWriteInTx(
  tx: Prisma.TransactionClient,
  actor: FoodPlanActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
  const current = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (
    !current ||
    current.family_id !== actor.familyId ||
    current.role !== actor.role ||
    current.token_version !== actor.generation
  )
    refuse(403, "AUTH_CONTEXT_CHANGED");
  if (!["parent", "teen"].includes(actor.role)) refuse(403, "FORBIDDEN");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), "meals"))
    refuse(403, "FORBIDDEN");
}
/** Root receipt is reserved by the normal idempotency boundary. Child receipts
 * are born and completed inside this transaction, never independently committed.
 * Exact replay returns pointers, including pointers to subsequently deleted rows;
 * it never recreates a missing meal/prep/list item or extends grocery Undo. */
export async function persistReviewedFoodPlan(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  raw: ReviewedFoodWrite,
  recordId: string,
  guard: FoodWriteSourceGuard,
): Promise<EffectResult> {
  const input = reviewedFoodWrite.parse(raw);
  return db.$transaction(
    async (tx) => {
      await authorizeFoodWriteInTx(tx, actor);
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
      const root = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          scope: `user:${actor.userId}`,
          user_id: actor.userId,
          family_id: actor.familyId,
          action: FOOD_APPLY_ACTION,
          request_hash: hashIdempotentRequest(FOOD_APPLY_ACTION, input),
        },
        select: {
          response_status: true,
          response_body: true,
          expires_at: true,
        },
      });
      if (!root) refuse(409, "IDEMPOTENCY_IN_PROGRESS");
      if (root.response_status !== null) {
        const saved = foodApplyReceipt.safeParse(root.response_body);
        if (root.response_status !== 201 || !saved.success)
          refuse(409, "RECEIPT_UNAVAILABLE");
        return { status: 201, body: saved.data };
      }
      if (root.expires_at.getTime() <= Date.now())
        refuse(409, "FOOD_INTENT_EXPIRED");
      if (!foodPlanningEnabled()) refuse(409, "UNAVAILABLE");
      const family = await tx.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      const features = normalizeFeatures(family?.features);
      if (
        !isFeatureEnabled(features, "inventory") ||
        (input.groceries.length && !isFeatureEnabled(features, "lists"))
      )
        refuse(403, "FORBIDDEN");
      await guard.verify(tx, actor, input);
      guard.assertCurrent();
      const canonicalActor = {
        userId: actor.userId,
        familyId: actor.familyId,
        tokenVersion: actor.generation,
      };
      let childIndex = 0;
      async function child(action: string, body: unknown) {
        const row = await tx.idempotencyRecord.create({
          data: {
            scope: `user:${actor.userId}`,
            key: `food-child:${recordId}:${childIndex++}`,
            user_id: actor.userId,
            family_id: actor.familyId,
            action,
            request_hash: hashIdempotentRequest(action, body),
            expires_at: root.expires_at,
          },
          select: { id: true },
        });
        return row.id;
      }
      const receipt: FoodApplyReceipt = {
        meals: [],
        prep: null,
        groceries: [],
      };
      const targets = new Map<
        string,
        {
          recipeId: string;
          servings?: number;
          mealId?: string;
          batchId?: string;
        }
      >();
      if (input.mode === "meals") {
        for (const row of input.meals) {
          const requestId = await child(MEAL_CREATE_ACTION, row.input);
          const saved = mealCreateReceipt.parse(
            success(
              await createMealWithReceiptInTx(
                tx,
                canonicalActor,
                row.input,
                requestId,
              ),
            ),
          );
          receipt.meals.push({ key: row.key, mealId: saved.mealId });
          targets.set(row.key, {
            recipeId: row.input.recipe_id!,
            mealId: saved.mealId,
            servings: row.input.servings ?? undefined,
          });
        }
      } else {
        const requestId = await child("meal-prep.create", input.input);
        const saved = z
          .object({
            sessionId: id,
            batchIds: z.array(id).max(8),
            mealIds: z.array(id).max(112),
          })
          .strict()
          .parse(
            success(
              await persistMealPrepInTx(
                tx,
                canonicalActor,
                input.input,
                requestId,
              ),
            ),
          );
        if (saved.batchIds.length !== input.dishKeys.length)
          refuse(409, "SAVE_UNCONFIRMED");
        receipt.prep = {
          sessionId: saved.sessionId,
          dishes: saved.batchIds.map((batchId, index) => ({
            key: input.dishKeys[index],
            batchId,
          })),
        };
        input.dishKeys.forEach((key, index) =>
          targets.set(key, {
            recipeId: input.input.dishes[index].recipe_id!,
            batchId: saved.batchIds[index],
            servings: input.input.dishes[index].total_servings,
          }),
        );
      }
      for (const selection of input.groceries) {
        // Full scaled canonical recipe quantities, never estimated shortfalls.
        const grocery = addFromRecipeSchema.parse({
          ...targets.get(selection.key)!,
          listId: selection.listId,
          ingredientIds: selection.ingredientIds,
        });
        const requestId = await child(ADD_FROM_RECIPE_ACTION, grocery);
        const result = await addRecipeToGroceriesInTx(
          tx,
          grocery,
          {
            id: actor.userId,
            family_id: actor.familyId,
            tokenVersion: actor.generation,
          },
          requestId,
        );
        const saved = z
          .object({ listId: id, requestId: id })
          .passthrough()
          .parse(success(result));
        if (saved.requestId !== requestId || saved.listId !== selection.listId)
          refuse(409, "SAVE_UNCONFIRMED");
        await tx.idempotencyRecord.update({
          where: { id: requestId },
          data: {
            response_status: result.status,
            response_body: result.body as Prisma.InputJsonValue,
          },
        });
        receipt.groceries.push({
          key: selection.key,
          requestId,
          listId: saved.listId,
        });
      }
      if (!foodPlanningEnabled()) refuse(409, "UNAVAILABLE");
      guard.assertCurrent();
      const body = foodApplyReceipt.parse(receipt);
      if (JSON.stringify(body).length > IDEMPOTENCY_MAX_BODY_CHARS)
        refuse(409, "RECEIPT_UNAVAILABLE");
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 201, response_body: body },
      });
      return { status: 201, body };
    },
    { isolationLevel: "Serializable", timeout: 15000 },
  );
}
