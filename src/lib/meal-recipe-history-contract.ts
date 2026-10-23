import { z } from "zod";
const id = z.string().min(1).max(128);
const nullableText = (max: number) => z.string().max(max).nullable();
export const mealRecipeSnapshot = z
  .object({
    v: z.literal(1),
    recipe: z
      .object({
        id,
        title: z.string().min(1).max(200),
        description: nullableText(2000),
        instructions: nullableText(20000),
        source_url: nullableText(1500),
        revision: z.number().int().nonnegative(),
        servings: z.number().int().min(1).max(100),
        prep_time: z.number().int().min(0).max(1440).nullable(),
        cook_time: z.number().int().min(0).max(1440).nullable(),
        ingredients: z
          .array(
            z
              .object({
                id,
                amount: z.number().finite().min(0).max(100000),
                unit: nullableText(32),
                note: nullableText(200),
                ingredient: z
                  .object({
                    id,
                    name: z.string().min(1).max(200),
                    unit: nullableText(32),
                  })
                  .strict(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict();
export type MealRecipeSnapshot = z.infer<typeof mealRecipeSnapshot>;
export const RECIPE_SNAPSHOT_MAX_BYTES = 512 * 1024;
