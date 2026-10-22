/** Browser/server read contract; this never grants mutation authority. */
import { z } from "zod";
import { MEAL_TYPES } from "./meal-slots";
export const MEAL_PAGE_SIZE = 100;
export const MEAL_PAGE_MAX = 200;
const recipe = z.object({
  id: z.string().min(1),
  title: z.string(),
  prep_time: z.number().nullable(),
  cook_time: z.number().nullable(),
  servings: z.number().nullable(),
});
export const mealListPageSchema = z.object({
  meals: z
    .array(
      z.object({
        id: z.string().min(1),
        date: z.string().datetime(),
        meal_type: z.enum(MEAL_TYPES),
        recipe_name: z.string().nullable(),
        notes: z.string().nullable().optional(),
        cook_id: z.string().nullable().optional(),
        batch_id: z.string().nullable().optional(),
        batch_allocation_key: z.string().nullable().optional(),
        recipe_id: z.string().nullable().optional(),
        servings: z.number().nullable().optional(),
        recipe: recipe.nullable().optional(),
      }),
    )
    .max(MEAL_PAGE_MAX),
  nextCursor: z.string().min(1).max(1024).nullable(),
});
