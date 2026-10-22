/** Scope/cap canonical meal and bulk-prep commitments. No record is changed. */
import type { Prisma } from "@prisma/client";
import { batchPortionCounts } from "../meal-batches";
import { toDateOnlyUTC, parseDateOnly } from "../dates";
import { addDaysToKey } from "../local-day-key";
import type { FoodCommitment, PreparedFoodPortions } from "./contract";
export class FoodCommitmentSourceUnavailable extends Error {
  constructor(readonly code: "SOURCE_LIMIT" | "UNAVAILABLE" = "UNAVAILABLE") {
    super(code);
  }
}
export type CommitmentMeal = {
  id: string;
  date: Date;
  meal_type: string;
  recipe_id: string | null;
  batch_id: string | null;
  servings: number | null;
  recipe_name?: string | null;
};
export async function readFoodCommitments(
  tx: Prisma.TransactionClient,
  familyId: string,
  horizon: { from: string; through: string },
  meals: CommitmentMeal[],
) {
  const end = parseDateOnly(addDaysToKey(horizon.through, 1))!;
  // Select pending prep through the horizon, including overdue unprepared work,
  // and explicitly prepared dishes with remaining portions. Consumed history
  // cannot crowd live work out of a capped newest-first query.
  const selected = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT s."id" FROM "MealPrepSession" s WHERE s."family_id"=${familyId} AND (
      (s."prepared_at" IS NULL AND s."prepared_on" < ${end}) OR
      (s."prepared_at" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "MealBatch" b WHERE b."family_id"=${familyId} AND b."prep_session_id"=s."id"
        AND b."total_servings" > COALESCE((SELECT SUM(c."servings") FROM "MealBatchConsumption" c
          WHERE c."family_id"=${familyId} AND c."batch_id"=b."id" AND c."cancelled_at" IS NULL),0)
      ))) ORDER BY s."id" LIMIT 51`;
  if (!Array.isArray(selected)) throw new FoodCommitmentSourceUnavailable();
  if (selected.length > 50)
    throw new FoodCommitmentSourceUnavailable("SOURCE_LIMIT");
  const linkedIds = [
    ...new Set(meals.flatMap((row) => (row.batch_id ? [row.batch_id] : []))),
  ];
  const linked = linkedIds.length
    ? await tx.mealBatch.findMany({
        where: { family_id: familyId, id: { in: linkedIds } },
        select: { id: true, prep_session_id: true },
        take: 501,
      })
    : [];
  if (linked.length !== linkedIds.length)
    throw new FoodCommitmentSourceUnavailable();
  const sessionIds = [
    ...new Set([
      ...selected.map((row) => row.id),
      ...linked.map((row) => row.prep_session_id),
    ]),
  ].sort();
  if (sessionIds.length > 50)
    throw new FoodCommitmentSourceUnavailable("SOURCE_LIMIT");
  const sessions = sessionIds.length
    ? await tx.mealPrepSession.findMany({
        where: { id: { in: sessionIds }, family_id: familyId },
        select: {
          id: true,
          prepared_on: true,
          prepared_at: true,
          next_prep_on: true,
          created_at: true,
        },
        orderBy: { id: "asc" },
        take: 51,
      })
    : [];
  if (sessions.length !== sessionIds.length)
    throw new FoodCommitmentSourceUnavailable();
  const batches = sessionIds.length
    ? await tx.mealBatch.findMany({
        where: { family_id: familyId, prep_session_id: { in: sessionIds } },
        select: {
          id: true,
          prep_session_id: true,
          name: true,
          total_servings: true,
          reserve_storage: true,
          recipe_id: true,
          recipe_snapshot_at: true,
          created_at: true,
        },
        orderBy: { id: "asc" },
        take: 201,
      })
    : [];
  if (batches.length > 200)
    throw new FoodCommitmentSourceUnavailable("SOURCE_LIMIT");
  const batchIds = batches.map((row) => row.id);
  const allocations = batchIds.length
    ? await tx.familyMeal.findMany({
        where: { family_id: familyId, batch_id: { in: batchIds } },
        select: {
          id: true,
          batch_id: true,
          date: true,
          servings: true,
          recipe_id: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { id: "asc" },
        take: 1001,
      })
    : [];
  const consumption = batchIds.length
    ? await tx.mealBatchConsumption.findMany({
        where: {
          family_id: familyId,
          batch_id: { in: batchIds },
          cancelled_at: null,
        },
        select: {
          id: true,
          batch_id: true,
          meal_id: true,
          servings: true,
          consumed_at: true,
          allocation_key: true,
        },
        orderBy: { id: "asc" },
        take: 1001,
      })
    : [];
  if (allocations.length > 1000 || consumption.length > 1000)
    throw new FoodCommitmentSourceUnavailable("SOURCE_LIMIT");
  // Existence only, never foreign labels or private dependent content. Reject
  // inconsistent family links rather than silently treating a partial graph as complete.
  const invalid = await tx.$queryRaw<Array<{ invalid: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM "MealBatch" b JOIN "MealPrepSession" s ON s."id"=b."prep_session_id" WHERE b."family_id"=${familyId} AND s."family_id"<>${familyId}
      UNION ALL
      SELECT 1 FROM "MealPrepSession" s JOIN "MealBatch" b ON b."prep_session_id"=s."id" WHERE s."family_id"=${familyId} AND b."family_id"<>${familyId}
      UNION ALL
      SELECT 1 FROM "FamilyMeal" m JOIN "MealBatch" b ON b."id"=m."batch_id" WHERE m."family_id"=${familyId} AND b."family_id"<>${familyId}
      UNION ALL
      SELECT 1 FROM "MealBatch" b JOIN "FamilyMeal" m ON m."batch_id"=b."id" WHERE b."family_id"=${familyId} AND m."family_id"<>${familyId}
      UNION ALL
      SELECT 1 FROM "MealBatchConsumption" c JOIN "MealBatch" b ON b."id"=c."batch_id" WHERE c."family_id"=${familyId} AND b."family_id"<>${familyId}
      UNION ALL
      SELECT 1 FROM "MealBatch" b JOIN "MealBatchConsumption" c ON c."batch_id"=b."id" WHERE b."family_id"=${familyId} AND c."family_id"<>${familyId}
    ) AS invalid`;
  if (
    !Array.isArray(invalid) ||
    invalid.length !== 1 ||
    invalid[0].invalid !== false
  )
    throw new FoodCommitmentSourceUnavailable();
  const byBatch = new Map(batches.map((row) => [row.id, row]));
  const bySession = new Map(sessions.map((row) => [row.id, row]));
  const entries: FoodCommitment[] = [];
  const prepared: PreparedFoodPortions[] = [];
  const pendingRecipeIds = new Set<string>(),
    preparedRecipeIds = new Set<string>();
  for (const meal of meals) {
    if (meal.batch_id) {
      const batch = byBatch.get(meal.batch_id);
      const session = batch && bySession.get(batch.prep_session_id);
      if (
        !batch ||
        !session ||
        toDateOnlyUTC(meal.date) < toDateOnlyUTC(session.prepared_on) ||
        meal.recipe_id !== batch.recipe_id
      )
        throw new FoodCommitmentSourceUnavailable();
      continue; // The whole pending dish is counted once, never per allocation.
    }
    if (meal.recipe_name != null && meal.recipe_name.length > 200)
      throw new FoodCommitmentSourceUnavailable();
    entries.push({
      id: `meal:${meal.id}`,
      kind: "meal",
      label: meal.recipe_name?.trim() || null,
      date: toDateOnlyUTC(meal.date),
      originalDate: toDateOnlyUTC(meal.date),
      recipeId: meal.recipe_id,
      servings: meal.servings,
    });
    if (meal.recipe_id) pendingRecipeIds.add(meal.recipe_id);
  }
  for (const batch of batches) {
    const session = bySession.get(batch.prep_session_id);
    if (
      !session ||
      !batch.name.trim() ||
      batch.name.length > 200 ||
      !Number.isInteger(batch.total_servings) ||
      batch.total_servings < 1 ||
      batch.total_servings > 50
    )
      throw new FoodCommitmentSourceUnavailable();
    const batchMeals = allocations.filter((row) => row.batch_id === batch.id);
    const eaten = consumption.filter((row) => row.batch_id === batch.id);
    if (
      batchMeals.some(
        (row) =>
          row.servings === null ||
          !Number.isInteger(row.servings) ||
          row.servings < 1 ||
          row.servings > 50 ||
          toDateOnlyUTC(row.date) < toDateOnlyUTC(session.prepared_on) ||
          row.recipe_id !== batch.recipe_id,
      ) ||
      eaten.some(
        (row) =>
          !Number.isInteger(row.servings) ||
          row.servings < 1 ||
          row.servings > 50 ||
          (row.meal_id !== null &&
            !batchMeals.some((meal) => meal.id === row.meal_id)),
      )
    )
      throw new FoodCommitmentSourceUnavailable();
    const counts = batchPortionCounts(batch.total_servings, batchMeals, eaten);
    if (
      Object.values(counts).some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    )
      throw new FoodCommitmentSourceUnavailable();
    if (session.prepared_at) {
      if (!["fridge", "freezer"].includes(batch.reserve_storage))
        throw new FoodCommitmentSourceUnavailable();
      if (batch.recipe_id) preparedRecipeIds.add(batch.recipe_id);
      prepared.push({
        batchId: batch.id,
        sessionId: session.id,
        name: batch.name,
        recipeId: batch.recipe_id,
        preparedOn: toDateOnlyUTC(session.prepared_on),
        preparedAt: session.prepared_at.toISOString(),
        nextPrepOn: session.next_prep_on
          ? toDateOnlyUTC(session.next_prep_on)
          : null,
        storage: batch.reserve_storage as "fridge" | "freezer",
        total: batch.total_servings,
        ...counts,
        recipeHistoryRecorded: batch.recipe_snapshot_at !== null,
      });
    } else if (session.prepared_on < end) {
      const originalDate = toDateOnlyUTC(session.prepared_on);
      entries.push({
        id: `batch:${batch.id}`,
        kind: "prep-dish",
        label: batch.name,
        date: originalDate < horizon.from ? horizon.from : originalDate,
        originalDate,
        recipeId: batch.recipe_id,
        servings: batch.total_servings,
        stateUncertain: eaten.length > 0,
      });
      if (batch.recipe_id) pendingRecipeIds.add(batch.recipe_id);
    }
  }
  return {
    entries,
    prepared,
    pendingRecipeIds: [...pendingRecipeIds].sort(),
    preparedRecipeIds: [...preparedRecipeIds].sort(),
    sources: { sessions, batches, allocations, consumption },
  };
}
