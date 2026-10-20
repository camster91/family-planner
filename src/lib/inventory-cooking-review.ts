import type { PrismaClient } from "@prisma/client";
import {
  inventoryIntakeAuthority,
  type InventoryIntakeActor,
} from "@/lib/inventory-intake";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  mealRecipeSnapshot,
  RECIPE_SNAPSHOT_MAX_BYTES,
} from "@/lib/meal-recipe-history-contract";
import {
  cookingReview,
  type CookingReviewSource,
} from "@/lib/inventory-cooking-review-contract";
import { RECIPE_DETAIL_SELECT } from "@/lib/recipes";
const fail = (status: number, code: string) => ({
  status,
  body: { error: { code } },
});
export async function reviewCookingStock(
  db: Pick<PrismaClient, "$transaction">,
  actor: InventoryIntakeActor,
  source: CookingReviewSource,
) {
  return db.$transaction(async (tx) => {
    const refusal = await inventoryIntakeAuthority(tx, actor);
    if (refusal) return refusal;
    const family = await tx.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    });
    if (
      !family ||
      !isFeatureEnabled(normalizeFeatures(family.features), "meals")
    )
      return fail(403, "MEALS_DISABLED");
    let recipeId: string | null = source.kind === "recipe" ? source.id : null;
    let target = source.kind === "recipe" ? source.servings : undefined;
    let recorded: ReturnType<typeof mealRecipeSnapshot.parse>["recipe"] | null =
      null;
    if (source.kind === "batch") {
      const batch = await tx.mealBatch.findFirst({
        where: { id: source.id, family_id: actor.familyId },
        select: {
          recipe_id: true,
          total_servings: true,
          prep_session_id: true,
          recipe_snapshot: true,
          recipe_snapshot_at: true,
        },
      });
      if (!batch) return fail(404, "COOKING_SOURCE_UNAVAILABLE");
      const session = await tx.mealPrepSession.findFirst({
        where: { id: batch.prep_session_id, family_id: actor.familyId },
        select: { prepared_at: true },
      });
      if (!session) return fail(404, "COOKING_SOURCE_UNAVAILABLE");
      target = batch.total_servings;
      if (session.prepared_at) {
        const parsed = mealRecipeSnapshot.safeParse(batch.recipe_snapshot);
        if (
          !parsed.success ||
          !batch.recipe_snapshot_at ||
          new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength >
            RECIPE_SNAPSHOT_MAX_BYTES
        )
          return fail(409, "COOKING_HISTORY_UNAVAILABLE");
        recorded = parsed.data.recipe;
      } else {
        // Unexplained historical evidence must never be replaced with a live recipe.
        if (batch.recipe_snapshot_at || batch.recipe_snapshot !== null)
          return fail(409, "COOKING_HISTORY_UNAVAILABLE");
        recipeId = batch.recipe_id;
      }
    }
    const recipe =
      recorded ??
      (recipeId
        ? await tx.recipe.findFirst({
            where: { id: recipeId, family_id: actor.familyId },
            select: {
              id: true,
              title: true,
              servings: true,
              ingredients: { ...RECIPE_DETAIL_SELECT.ingredients, take: 101 },
            },
          })
        : null);
    if (!recipe || recipe.ingredients.length > 100)
      return fail(404, "COOKING_SOURCE_UNAVAILABLE");
    // Even historical ingredient IDs are hints, never authority over stock.
    // Live joins must also belong to this household.
    if (!recorded) {
      const ids = [
        ...new Set(recipe.ingredients.map((line) => line.ingredient.id)),
      ];
      const owned = await tx.ingredient.findMany({
        where: { id: { in: ids }, family_id: actor.familyId },
        select: { id: true },
      });
      if (owned.length !== ids.length)
        return fail(409, "COOKING_SOURCE_UNAVAILABLE");
    }
    const parsed = cookingReview.safeParse({
      userId: actor.userId,
      familyId: actor.familyId,
      source,
      title: recipe.title,
      basis: recorded ? "prepared-snapshot" : "current-recipe",
      baseServings: recipe.servings,
      targetServings: target ?? recipe.servings,
      lines: recipe.ingredients.map((line) => ({
        id: line.id,
        ingredientId: line.ingredient.id,
        name: line.ingredient.name,
        amount: line.amount,
        unit: line.unit,
      })),
    });
    return parsed.success
      ? { status: 200, body: parsed.data }
      : fail(409, "COOKING_SOURCE_UNAVAILABLE");
  });
}
