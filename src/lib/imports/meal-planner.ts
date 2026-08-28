import { z } from "zod";

const dateValue = z
  .union([z.string(), z.date()])
  .transform((value, context) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date",
      });
      return z.NEVER;
    }
    return date;
  });

export const mealPlannerExportSchema = z.object({
  version: z.string().min(1),
  users: z
    .array(
      z.object({ id: z.string().min(1), email: z.string(), name: z.string() }),
    )
    .default([]),
  recipes: z
    .array(
      z.object({
        id: z.string().min(1),
        userId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullish(),
        instructions: z.string().nullish(),
        prepTime: z.number().int().nonnegative().nullish(),
        cookTime: z.number().int().nonnegative().nullish(),
        servings: z.number().int().positive().default(2),
        imageUrl: z.string().nullish(),
        createdAt: dateValue,
      }),
    )
    .default([]),
  ingredients: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        unit: z.string().nullish(),
      }),
    )
    .default([]),
  recipeIngredients: z
    .array(
      z.object({
        id: z.string().min(1),
        recipeId: z.string().min(1),
        ingredientId: z.string().min(1),
        amount: z.number().nonnegative(),
        unit: z.string().nullish(),
        note: z.string().nullish(),
      }),
    )
    .default([]),
  mealPlans: z
    .array(
      z.object({
        id: z.string().min(1),
        userId: z.string().min(1),
        name: z.string().min(1),
        startDate: dateValue,
        endDate: dateValue,
        createdAt: dateValue,
      }),
    )
    .default([]),
  mealPlanEntries: z
    .array(
      z.object({
        id: z.string().min(1),
        mealPlanId: z.string().min(1),
        recipeId: z.string().min(1),
        date: dateValue,
        mealType: z.string().min(1),
        servings: z.number().int().positive().default(2),
      }),
    )
    .default([]),
  shoppingLists: z
    .array(
      z.object({
        id: z.string().min(1),
        userId: z.string().min(1),
        name: z.string().min(1),
        createdAt: dateValue,
      }),
    )
    .default([]),
  shoppingItems: z
    .array(
      z.object({
        id: z.string().min(1),
        shoppingListId: z.string().min(1),
        ingredientName: z.string().min(1),
        amount: z.number().nonnegative().nullish(),
        unit: z.string().nullish(),
        category: z.string().nullish(),
        checked: z.boolean().default(false),
        recipeId: z.string().nullish(),
      }),
    )
    .default([]),
});

export type MealPlannerImportPlan = ReturnType<typeof planMealPlannerImport>;

export function planMealPlannerImport(
  input: unknown,
  sourceUserToTargetUser: Readonly<Record<string, string>>,
) {
  const source = mealPlannerExportSchema.parse(input);
  const skippedRecords: Array<{
    sourceModel: string;
    sourceId: string;
    reason: string;
  }> = [];
  const recipeIds = new Set(source.recipes.map((item) => item.id));
  const ingredientIds = new Set(source.ingredients.map((item) => item.id));
  const mealPlanIds = new Set(source.mealPlans.map((item) => item.id));
  const shoppingListIds = new Set(source.shoppingLists.map((item) => item.id));
  const mappedOwner = (model: string, id: string, userId: string) => {
    const target = sourceUserToTargetUser[userId];
    if (!target)
      skippedRecords.push({
        sourceModel: model,
        sourceId: id,
        reason: `No user mapping for source user ${userId}`,
      });
    return target;
  };
  const recipes = source.recipes.flatMap((item) => {
    const createdBy = mappedOwner("Recipe", item.id, item.userId);
    return createdBy
      ? [
          {
            sourceId: item.id,
            createdBy,
            title: item.title.trim(),
            description: item.description?.trim() || null,
            instructions: item.instructions?.trim() || null,
            prepTime: item.prepTime ?? null,
            cookTime: item.cookTime ?? null,
            servings: item.servings,
            imageUrl: item.imageUrl || null,
            createdAt: item.createdAt,
          },
        ]
      : [];
  });
  const recipeIngredients = source.recipeIngredients.flatMap((item) => {
    if (
      !recipeIds.has(item.recipeId) ||
      !ingredientIds.has(item.ingredientId)
    ) {
      skippedRecords.push({
        sourceModel: "RecipeIngredient",
        sourceId: item.id,
        reason: "Missing source recipe or ingredient",
      });
      return [];
    }
    return [
      {
        sourceId: item.id,
        sourceRecipeId: item.recipeId,
        sourceIngredientId: item.ingredientId,
        amount: item.amount,
        unit: item.unit || null,
        note: item.note?.trim() || null,
      },
    ];
  });
  const mealPlans = source.mealPlans.flatMap((item) => {
    const createdBy = mappedOwner("MealPlan", item.id, item.userId);
    return createdBy
      ? [
          {
            sourceId: item.id,
            createdBy,
            name: item.name.trim(),
            startDate: item.startDate,
            endDate: item.endDate,
            createdAt: item.createdAt,
          },
        ]
      : [];
  });
  const mealPlanEntries = source.mealPlanEntries.flatMap((item) => {
    if (!mealPlanIds.has(item.mealPlanId) || !recipeIds.has(item.recipeId)) {
      skippedRecords.push({
        sourceModel: "MealPlanEntry",
        sourceId: item.id,
        reason: "Missing source meal plan or recipe",
      });
      return [];
    }
    return [
      {
        sourceId: item.id,
        sourceMealPlanId: item.mealPlanId,
        sourceRecipeId: item.recipeId,
        date: item.date,
        mealType: item.mealType.toLowerCase(),
        servings: item.servings,
      },
    ];
  });
  const shoppingLists = source.shoppingLists.flatMap((item) => {
    const createdBy = mappedOwner("ShoppingList", item.id, item.userId);
    return createdBy
      ? [
          {
            sourceId: item.id,
            createdBy,
            name: item.name.trim(),
            createdAt: item.createdAt,
          },
        ]
      : [];
  });
  const shoppingItems = source.shoppingItems.flatMap((item) => {
    if (!shoppingListIds.has(item.shoppingListId)) {
      skippedRecords.push({
        sourceModel: "ShoppingItem",
        sourceId: item.id,
        reason: `Missing source shopping list ${item.shoppingListId}`,
      });
      return [];
    }
    return [
      {
        sourceId: item.id,
        sourceShoppingListId: item.shoppingListId,
        ingredientName: item.ingredientName.trim(),
        amount: item.amount ?? null,
        unit: item.unit || null,
        category: item.category || null,
        checked: item.checked,
        sourceRecipeId: item.recipeId || null,
      },
    ];
  });
  return {
    sourceVersion: source.version,
    recipes,
    ingredients: source.ingredients.map((item) => ({
      sourceId: item.id,
      name: item.name.trim(),
      unit: item.unit || null,
    })),
    recipeIngredients,
    mealPlans,
    mealPlanEntries,
    shoppingLists,
    shoppingItems,
    skippedRecords,
  };
}
