/**
 * Meal Planner import, retargeted onto the canonical models (ADR-0007, #251).
 *
 *   Recipe / Ingredient / RecipeIngredient -> the same (already canonical)
 *   MealPlan                               -> no row (O-2: archive only). The
 *                                             plan's name and range go into
 *                                             ImportJob.summary.mealPlans[] and
 *                                             the mapping points at the job.
 *   MealPlanEntry                          -> FamilyMeal (recipe link + title snapshot)
 *   ShoppingList                           -> List (type 'grocery')
 *   ShoppingItem                           -> ListItem (source 'import')
 *
 * The frozen legacy tables (MealPlan, MealPlanEntry, ShoppingList,
 * ShoppingItem) are never written. Existing ImportedRecord mappings are
 * honoured whatever their target_model: a source row mapped by an earlier
 * (pre-retarget) import into a legacy table counts as imported, so
 * re-importing the same export creates 0 rows.
 *
 * Rules follow docs/architecture/MEALS_AND_GROCERIES.md §4: unknown meal
 * types are skipped and reported, never coerced; a slot that already holds a
 * meal with the same name is linked (recipe_id set only when null) instead of
 * duplicated; any other meal in the slot is kept and a second one is added
 * (O-1). Every reference is resolved inside the importing household.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IMPORTED_LIST_DESCRIPTION,
  cleanContent,
  matchIngredient,
  mealNamesMatch,
  normalizeMealType,
} from "@/lib/backfill/meals-groceries";
import {
  planMealPlannerImport,
  type MealPlannerImportPlan,
} from "./meal-planner";

const SOURCE_APP = "meal-planner";
type Summary = {
  created: Record<string, number>;
  reused: Record<string, number>;
  /** Source rows kept only as provenance (MealPlan, O-2). */
  archived: Record<string, number>;
  /** Source rows attached to an existing canonical row instead of a new one. */
  linked: Record<string, number>;
  skipped: Array<{ sourceModel: string; sourceId: string; reason: string }>;
  /** References dropped because they do not resolve in this household. */
  nulled: Array<{
    sourceModel: string;
    sourceId: string;
    field: string;
    reason: string;
  }>;
  /** Archived MealPlan headers (O-2). */
  mealPlans: Array<{
    sourceId: string;
    name: string;
    startDate: string;
    endDate: string;
  }>;
};
const increment = (bucket: Record<string, number>, model: string) => {
  bucket[model] = (bucket[model] ?? 0) + 1;
};

/** Date-only values are stored as UTC midnight (src/lib/dates.ts). */
function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export async function importMealPlanner(
  input: unknown,
  options: {
    familyId: string;
    startedBy: string;
    sourceUserToTargetUser: Readonly<Record<string, string>>;
    dryRun?: boolean;
  },
): Promise<{
  plan: MealPlannerImportPlan;
  summary: Summary;
  jobId: string | null;
}> {
  const plan = planMealPlannerImport(input, options.sourceUserToTargetUser);
  const summary: Summary = {
    created: {},
    reused: {},
    archived: {},
    linked: {},
    skipped: [...plan.skippedRecords],
    nulled: [],
    mealPlans: [],
  };
  if (options.dryRun !== false) return { plan, summary, jobId: null };
  if (!prisma) throw new Error("Database is not configured");
  const familyId = options.familyId;

  const job = await prisma.importJob.create({
    data: {
      family_id: familyId,
      source_app: SOURCE_APP,
      source_version: plan.sourceVersion,
      status: "running",
      dry_run: false,
      started_by: options.startedBy,
    },
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        const prior = await tx.importedRecord.findMany({
          where: { family_id: familyId, source_app: SOURCE_APP },
          select: {
            source_model: true,
            source_id: true,
            target_model: true,
            target_id: true,
          },
        });
        const mappings = new Map(
          prior.map((record) => [
            `${record.source_model}:${record.source_id}`,
            { model: record.target_model, id: record.target_id },
          ]),
        );
        const mapping = (model: string, id: string) =>
          mappings.get(`${model}:${id}`);
        const existing = (model: string, id: string) => mapping(model, id)?.id;
        const track = async (
          sourceModel: string,
          sourceId: string,
          targetModel: string,
          targetId: string,
        ) => {
          await tx.importedRecord.create({
            data: {
              family_id: familyId,
              import_job_id: job.id,
              source_app: SOURCE_APP,
              source_model: sourceModel,
              source_id: sourceId,
              target_model: targetModel,
              target_id: targetId,
            },
          });
          mappings.set(`${sourceModel}:${sourceId}`, {
            model: targetModel,
            id: targetId,
          });
        };
        const skip = (sourceModel: string, sourceId: string, reason: string) =>
          summary.skipped.push({ sourceModel, sourceId, reason });

        for (const source of plan.ingredients) {
          if (existing("Ingredient", source.sourceId)) {
            increment(summary.reused, "Ingredient");
            continue;
          }
          const target = await tx.ingredient.upsert({
            where: {
              family_id_name: {
                family_id: familyId,
                name: source.name,
              },
            },
            update: {},
            create: {
              family_id: familyId,
              name: source.name,
              unit: source.unit,
            },
          });
          await track("Ingredient", source.sourceId, "Ingredient", target.id);
          increment(summary.created, "Ingredient");
        }
        for (const source of plan.recipes) {
          if (existing("Recipe", source.sourceId)) {
            increment(summary.reused, "Recipe");
            continue;
          }
          const target = await tx.recipe.create({
            data: {
              family_id: familyId,
              title: source.title,
              description: source.description,
              instructions: source.instructions,
              prep_time: source.prepTime,
              cook_time: source.cookTime,
              servings: source.servings,
              image_url: source.imageUrl,
              created_by: source.createdBy,
              created_at: source.createdAt,
            },
          });
          await track("Recipe", source.sourceId, "Recipe", target.id);
          increment(summary.created, "Recipe");
        }

        // Mapped recipes that still exist in this household (a recipe can be
        // deleted through /api/recipes after an earlier import).
        const mappedRecipeIds = [
          ...new Set(
            [
              ...plan.recipeIngredients.map((r) => r.sourceRecipeId),
              ...plan.mealPlanEntries.map((e) => e.sourceRecipeId),
              ...plan.shoppingItems.map((i) => i.sourceRecipeId),
            ]
              .map((id) => (id ? existing("Recipe", id) : undefined))
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const liveRecipes = new Map(
          (mappedRecipeIds.length > 0
            ? await tx.recipe.findMany({
                where: { id: { in: mappedRecipeIds }, family_id: familyId },
                select: { id: true, title: true },
              })
            : []
          ).map((r) => [r.id, r.title]),
        );
        const liveRecipe = (sourceRecipeId: string | null) => {
          const id = sourceRecipeId
            ? existing("Recipe", sourceRecipeId)
            : undefined;
          return id && liveRecipes.has(id)
            ? { id, title: liveRecipes.get(id)! }
            : null;
        };

        for (const source of plan.recipeIngredients) {
          if (existing("RecipeIngredient", source.sourceId)) {
            increment(summary.reused, "RecipeIngredient");
            continue;
          }
          const recipe = liveRecipe(source.sourceRecipeId),
            ingredientId = existing("Ingredient", source.sourceIngredientId);
          if (!recipe || !ingredientId) {
            skip(
              "RecipeIngredient",
              source.sourceId,
              "Recipe or ingredient was not imported",
            );
            continue;
          }
          const target = await tx.recipeIngredient.upsert({
            where: {
              recipe_id_ingredient_id: {
                recipe_id: recipe.id,
                ingredient_id: ingredientId,
              },
            },
            update: {},
            create: {
              recipe_id: recipe.id,
              ingredient_id: ingredientId,
              amount: source.amount,
              unit: source.unit,
              note: source.note,
            },
          });
          await track(
            "RecipeIngredient",
            source.sourceId,
            "RecipeIngredient",
            target.id,
          );
          increment(summary.created, "RecipeIngredient");
        }

        // MealPlan: archive only (O-2). Any existing mapping, including a
        // pre-retarget `target_model = 'MealPlan'` one, means "imported".
        for (const source of plan.mealPlans) {
          if (existing("MealPlan", source.sourceId)) {
            increment(summary.reused, "MealPlan");
            continue;
          }
          summary.mealPlans.push({
            sourceId: source.sourceId,
            name: source.name,
            startDate: source.startDate.toISOString(),
            endDate: source.endDate.toISOString(),
          });
          await track("MealPlan", source.sourceId, "ImportJob", job.id);
          increment(summary.archived, "MealPlan");
        }

        const planOwner = new Map(
          plan.mealPlans.map((p) => [p.sourceId, p.createdBy]),
        );
        for (const source of plan.mealPlanEntries) {
          if (existing("MealPlanEntry", source.sourceId)) {
            increment(summary.reused, "MealPlanEntry");
            continue;
          }
          const createdBy = planOwner.get(source.sourceMealPlanId);
          const recipe = liveRecipe(source.sourceRecipeId);
          if (!createdBy || !recipe) {
            skip(
              "MealPlanEntry",
              source.sourceId,
              "Meal plan or recipe was not imported",
            );
            continue;
          }
          const mealType = normalizeMealType(source.mealType);
          if (!mealType) {
            skip(
              "MealPlanEntry",
              source.sourceId,
              `Unsupported meal type "${source.mealType}"`,
            );
            continue;
          }
          const date = utcDay(source.date);
          const inSlot = await tx.familyMeal.findMany({
            where: { family_id: familyId, date, meal_type: mealType },
            select: { id: true, recipe_name: true, recipe_id: true },
            orderBy: [{ created_at: "asc" }, { id: "asc" }],
          });
          const same = inSlot.find((m) =>
            mealNamesMatch(m.recipe_name, recipe.title),
          );
          if (same) {
            if (!same.recipe_id) {
              await tx.familyMeal.update({
                where: { id: same.id },
                data: { recipe_id: recipe.id },
              });
            }
            await track(
              "MealPlanEntry",
              source.sourceId,
              "FamilyMeal",
              same.id,
            );
            increment(summary.linked, "FamilyMeal");
            continue;
          }
          const target = await tx.familyMeal.create({
            data: {
              family_id: familyId,
              date,
              meal_type: mealType,
              recipe_name: recipe.title,
              recipe_id: recipe.id,
              servings: source.servings,
              created_by: createdBy,
            },
          });
          await track(
            "MealPlanEntry",
            source.sourceId,
            "FamilyMeal",
            target.id,
          );
          increment(summary.created, "FamilyMeal");
        }

        for (const source of plan.shoppingLists) {
          if (existing("ShoppingList", source.sourceId)) {
            increment(summary.reused, "ShoppingList");
            continue;
          }
          const target = await tx.list.create({
            data: {
              family_id: familyId,
              name: source.name,
              type: "grocery",
              description: IMPORTED_LIST_DESCRIPTION,
              created_by: source.createdBy,
              created_at: source.createdAt,
            },
          });
          await track("ShoppingList", source.sourceId, "List", target.id);
          increment(summary.created, "List");
        }

        // Only canonical Lists of this household receive items. A list that an
        // earlier (pre-retarget) import put in the legacy ShoppingList table,
        // or a list deleted since, gets no new items: they are reported.
        const mappedListIds = [
          ...new Set(
            plan.shoppingItems
              .map((i) => mapping("ShoppingList", i.sourceShoppingListId))
              .filter((m) => m?.model === "List")
              .map((m) => m!.id),
          ),
        ];
        const liveLists = new Set(
          (mappedListIds.length > 0
            ? await tx.list.findMany({
                where: { id: { in: mappedListIds }, family_id: familyId },
                select: { id: true },
              })
            : []
          ).map((l) => l.id),
        );
        const listOwner = new Map(
          plan.shoppingLists.map((l) => [l.sourceId, l.createdBy]),
        );
        const nextPosition = new Map<string, number>();
        const familyIngredients = plan.shoppingItems.length
          ? await tx.ingredient.findMany({
              where: { family_id: familyId },
              select: { id: true, name: true },
            })
          : [];

        for (const source of plan.shoppingItems) {
          if (existing("ShoppingItem", source.sourceId)) {
            increment(summary.reused, "ShoppingItem");
            continue;
          }
          const list = mapping("ShoppingList", source.sourceShoppingListId);
          if (!list) {
            skip(
              "ShoppingItem",
              source.sourceId,
              "Shopping list was not imported",
            );
            continue;
          }
          if (list.model !== "List" || !liveLists.has(list.id)) {
            skip(
              "ShoppingItem",
              source.sourceId,
              "Shopping list is archived or no longer exists",
            );
            continue;
          }
          const content = cleanContent(source.ingredientName);
          if (!content) {
            skip("ShoppingItem", source.sourceId, "Empty ingredient name");
            continue;
          }
          let recipeId: string | null = null;
          if (source.sourceRecipeId) {
            recipeId = liveRecipe(source.sourceRecipeId)?.id ?? null;
            if (!recipeId) {
              summary.nulled.push({
                sourceModel: "ShoppingItem",
                sourceId: source.sourceId,
                field: "recipe_id",
                reason: "Recipe was not imported into this household",
              });
            }
          }
          let position = nextPosition.get(list.id);
          if (position === undefined) {
            const max = await tx.listItem.aggregate({
              where: { list_id: list.id },
              _max: { position: true },
            });
            position = (max._max.position ?? 0) + 1;
          }
          nextPosition.set(list.id, position + 1);
          const target = await tx.listItem.create({
            data: {
              list_id: list.id,
              content,
              quantity: 1,
              amount: source.amount,
              unit: source.unit,
              category: source.category,
              checked: source.checked,
              added_by:
                listOwner.get(source.sourceShoppingListId) ?? options.startedBy,
              position,
              recipe_id: recipeId,
              ingredient_id: matchIngredient(content, familyIngredients),
              source: "import",
            },
          });
          await track("ShoppingItem", source.sourceId, "ListItem", target.id);
          increment(summary.created, "ListItem");
        }
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            completed_at: new Date(),
            summary: summary as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completed_at: new Date(),
        error:
          error instanceof Error ? error.message : "Unknown import failure",
      },
    });
    throw error;
  }
  return { plan, summary, jobId: job.id };
}
