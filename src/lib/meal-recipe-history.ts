import type { Prisma } from "@prisma/client";
import {
  canonicalRecipeSource,
  legacyRecipeSource,
} from "@/lib/recipe-curation-contract";
import { RECIPE_DETAIL_SELECT, RECIPE_SUMMARY_SELECT } from "@/lib/recipes";
import {
  mealRecipeSnapshot,
  RECIPE_SNAPSHOT_MAX_BYTES,
  type MealRecipeSnapshot,
} from "@/lib/meal-recipe-history-contract";
export {
  mealRecipeSnapshot,
  RECIPE_SNAPSHOT_MAX_BYTES,
} from "@/lib/meal-recipe-history-contract";
export class RecipeHistoryUnavailable extends Error {}
/** Read current canonical recipe under a row lock, never a client/model-supplied snapshot. */
async function captureRecipe(
  tx: Prisma.TransactionClient,
  familyId: string,
  recipeId: string,
): Promise<MealRecipeSnapshot> {
  await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipeId} AND "family_id" = ${familyId} FOR SHARE`;
  const recipe = await tx.recipe.findFirst({
    where: { id: recipeId, family_id: familyId },
    select: { ...RECIPE_SUMMARY_SELECT, instructions: true },
  });
  if (!recipe) throw new RecipeHistoryUnavailable();
  const lines = await tx.recipeIngredient.findMany({
    where: { recipe_id: recipe.id },
    orderBy: RECIPE_DETAIL_SELECT.ingredients.orderBy,
    select: {
      id: true,
      amount: true,
      unit: true,
      note: true,
      ingredient_id: true,
    },
  });
  const ingredients = await tx.ingredient.findMany({
    where: {
      id: { in: lines.map((line) => line.ingredient_id) },
      family_id: familyId,
    },
    select: { id: true, name: true, unit: true },
  });
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  if (lines.some((line) => !byId.has(line.ingredient_id)))
    throw new RecipeHistoryUnavailable();
  const parsed = mealRecipeSnapshot.safeParse({
    v: 1,
    recipe: {
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      instructions: recipe.instructions,
      source_url: recipe.source_url
        ? canonicalRecipeSource(recipe.source_url)
        : legacyRecipeSource(recipe.description),
      revision: recipe.revision,
      servings: recipe.servings,
      prep_time: recipe.prep_time,
      cook_time: recipe.cook_time,
      ingredients: lines.map(({ ingredient_id, ...line }) => ({
        ...line,
        ingredient: byId.get(ingredient_id),
      })),
    },
  });
  if (
    !parsed.success ||
    new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength >
      RECIPE_SNAPSHOT_MAX_BYTES
  )
    throw new RecipeHistoryUnavailable();
  return parsed.data;
}
/** Caller already holds current User/household authorization locks and one receipt transaction. */
export async function capturePrepRecipeHistory(
  tx: Prisma.TransactionClient,
  familyId: string,
  sessionId: string,
  capturedAt: Date,
) {
  const batches = await tx.mealBatch.findMany({
    where: { family_id: familyId, prep_session_id: sessionId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 9,
    select: {
      id: true,
      recipe_id: true,
      recipe_snapshot_at: true,
      recipe_snapshot: true,
    },
  });
  if (!batches.length || batches.length > 8)
    throw new RecipeHistoryUnavailable();
  const captures: Array<{ id: string; snapshot: MealRecipeSnapshot }> = [];
  for (const batch of batches) {
    // Do not overwrite unexplained existing evidence on an unprepared session.
    if (batch.recipe_snapshot_at || batch.recipe_snapshot !== null)
      throw new RecipeHistoryUnavailable();
    if (batch.recipe_id)
      captures.push({
        id: batch.id,
        snapshot: await captureRecipe(tx, familyId, batch.recipe_id),
      });
  }
  // All reads/validation precede writes. The surrounding receipt transaction
  // rolls every capture back if any subsequent prepared/receipt write fails.
  for (const capture of captures)
    await tx.mealBatch.update({
      where: { id: capture.id },
      data: {
        recipe_snapshot: capture.snapshot,
        recipe_snapshot_at: capturedAt,
      },
    });
}
