import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MEAL_INCLUDE } from "@/lib/meal-recipe-link";
import {
  authorizeMealBatchInTx,
  batchFailure,
  batchJson,
} from "@/lib/meal-batch-api";
import { batchPortionCounts } from "@/lib/meal-batches";

/** Existing clients still edit ordinary slots; batch reservations remain bounded. */
export async function mutateBatchedMeal(
  actor: { userId: string; familyId: string; tokenVersion: number },
  id: string,
  data?: Prisma.FamilyMealUncheckedUpdateInput,
) {
  return prisma!.$transaction(async (tx) => {
    const refusal = await authorizeMealBatchInTx(tx, actor, true);
    if (refusal) return batchJson(refusal);
    const meal = await tx.familyMeal.findFirst({
      where: { id, family_id: actor.familyId },
    });
    if (!meal) return batchJson(batchFailure(404, "MEAL_UNAVAILABLE"));
    if (!data) {
      // Consumption has its own batch ownership and survives this deletion.
      await tx.familyMeal.delete({ where: { id: meal.id } });
      return batchJson({ status: 200, body: { success: true } });
    }
    if (
      typeof data.cook_id === "string" &&
      !(await tx.user.findFirst({
        where: { id: data.cook_id, family_id: actor.familyId },
        select: { id: true },
      }))
    )
      return batchJson(batchFailure(400, "COOK_UNAVAILABLE"));
    if (
      typeof data.recipe_id === "string" &&
      !(await tx.recipe.findFirst({
        where: { id: data.recipe_id, family_id: actor.familyId },
        select: { id: true },
      }))
    )
      return batchJson(batchFailure(404, "RECIPE_UNAVAILABLE"));
    if (meal.batch_id) {
      const batch = await tx.mealBatch.findFirst({
        where: { id: meal.batch_id, family_id: actor.familyId },
        include: {
          prep_session: true,
          meals: {
            where: { family_id: actor.familyId },
            select: { id: true, servings: true },
          },
          consumption: {
            where: { family_id: actor.familyId, cancelled_at: null },
            select: { meal_id: true, servings: true },
          },
        },
      });
      if (!batch || batch.prep_session.family_id !== actor.familyId)
        return batchJson(batchFailure(404, "BATCH_UNAVAILABLE"));
      const recipeChanged =
        data.recipe_id !== undefined && data.recipe_id !== meal.recipe_id;
      const unlinkedDishChanged =
        !meal.recipe_id &&
        data.recipe_name !== undefined &&
        data.recipe_name !== meal.recipe_name;
      if (recipeChanged || unlinkedDishChanged)
        data = { ...data, batch_id: null, batch_allocation_key: null };
      else {
        if (
          data.date instanceof Date &&
          data.date < batch.prep_session.prepared_on
        )
          return batchJson(batchFailure(400, "BEFORE_PREPARATION"));
        const servings =
          data.servings === undefined ? meal.servings : data.servings;
        const consumed = batch.consumption
          .filter((row) => row.meal_id === meal.id)
          .reduce((sum, row) => sum + row.servings, 0);
        if (typeof servings !== "number" || servings < Math.max(1, consumed))
          return batchJson(batchFailure(409, "STATE_CHANGED"));
        const counts = batchPortionCounts(
          batch.total_servings,
          batch.meals,
          batch.consumption,
        );
        const capacity =
          counts.unplanned + Math.max(0, (meal.servings ?? 0) - consumed);
        if (servings - consumed > capacity)
          return batchJson(batchFailure(409, "BATCH_FULL"));
      }
    }
    const updated = await tx.familyMeal.update({
      where: { id: meal.id },
      data,
      include: MEAL_INCLUDE,
    });
    return batchJson({ status: 200, body: { meal: updated } });
  });
}
