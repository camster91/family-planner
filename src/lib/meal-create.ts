/** Canonical ordinary meal + pointer receipt, committed in one transaction. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeMealBatchInTx } from "@/lib/meal-batch-api";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import {
  mealCreateReceipt,
  type MealCreateInput,
} from "@/lib/meal-create-contract";
import { parseDateOnly } from "@/lib/dates";
import { resolveMealLink } from "@/lib/meal-recipe-link";
type Db = Pick<PrismaClient, "$transaction">;
export type MealCreateActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};
export const MEAL_CREATE_ACTION = "meal.create.v1";
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
export const authorizeMealCreate = (
  tx: Prisma.TransactionClient,
  actor: MealCreateActor,
) => authorizeMealBatchInTx(tx, actor, true);
export async function createMealWithReceipt(
  db: Db,
  actor: MealCreateActor,
  input: MealCreateInput,
  recordId: string,
) {
  return db.$transaction(async (tx) => {
    const refusal = await authorizeMealCreate(tx, actor);
    if (refusal) return refusal;
    if (
      input.expected_family_id !== actor.familyId ||
      input.expected_user_id !== actor.userId
    )
      return failure(403, "AUTH_CONTEXT_CHANGED");
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        scope: `user:${actor.userId}`,
        family_id: actor.familyId,
        user_id: actor.userId,
        action: MEAL_CREATE_ACTION,
        request_hash: hashIdempotentRequest(MEAL_CREATE_ACTION, input),
      },
      select: { response_status: true, response_body: true },
    });
    if (!receipt) return failure(409, "IDEMPOTENCY_IN_PROGRESS");
    if (receipt.response_status !== null)
      return { status: receipt.response_status, body: receipt.response_body };
    // An abandoned browser must not recreate a meal after its receipt expires.
    const age = Date.now() - new Date(input.issued_at).getTime();
    if (age < -60000 || age > IDEMPOTENCY_TTL_MS - 3600000)
      return failure(409, "MEAL_INTENT_EXPIRED");
    if (
      input.cook_id &&
      !(await tx.user.findFirst({
        where: { id: input.cook_id, family_id: actor.familyId },
        select: { id: true },
      }))
    )
      return failure(400, "COOK_UNAVAILABLE");
    const link = await resolveMealLink(tx, actor.familyId, input);
    if (!link.ok) return failure(400, "RECIPE_UNAVAILABLE");
    const meal = await tx.familyMeal.create({
      data: {
        family_id: actor.familyId,
        date: parseDateOnly(input.date)!,
        meal_type: input.meal_type,
        recipe_name: input.recipe_name ?? link.recipeTitle ?? "",
        notes: input.notes ?? null,
        cook_id: input.cook_id ?? null,
        recipe_id: link.recipeId ?? null,
        servings: link.servings ?? null,
        created_by: actor.userId,
      },
      select: { id: true },
    });
    const body = { mealId: meal.id };
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 201, response_body: body },
    });
    return { status: 201, body, created: true };
  });
}
/** Renew authority and check existence; replay never recreates a deleted meal. */
export async function confirmCreatedMeal(
  db: Db,
  actor: MealCreateActor,
  result: EffectResult,
): Promise<EffectResult> {
  if (result.status !== 201) return result;
  const parsed = mealCreateReceipt.safeParse(result.body);
  if (!parsed.success) return failure(409, "MEAL_CONFIRMATION_UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const refusal = await authorizeMealCreate(tx, actor);
    if (refusal) return refusal;
    const meal = await tx.familyMeal.findFirst({
      where: { id: parsed.data.mealId, family_id: actor.familyId },
      select: { id: true },
    });
    return meal ? result : failure(409, "MEAL_NO_LONGER_AVAILABLE");
  });
}
