/** Browser-safe canonical recipe input validation; no database/runtime imports. */
import { z } from "zod";
import { recipeOwnerSchema } from "@/lib/recipe-owner-contract";
import { recipeSourceField } from "@/lib/recipe-curation-contract";
export const RECIPE_MAX_INGREDIENTS = 100;
// Accommodates all bounded fields/100 ingredient lines even with JSON escapes.
// This transport budget also bounds whitespace/unknown fields before validation.
export const RECIPE_WRITE_MAX_BYTES = 1024 * 1024;

const optionalText = (max: number) =>
  z
    .union([z.string().max(max).trim(), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

const minutes = z
  .union([
    z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    z.null(),
  ])
  .optional();

const ingredientLine = z
  .object({
    ingredient_id: z.string().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    amount: z.number().finite().min(0).max(100000),
    unit: optionalText(32),
    note: optionalText(200),
  })
  .strict()
  .refine((v) => Boolean(v.ingredient_id) !== Boolean(v.name), {
    message: "Each ingredient needs exactly one of ingredient_id or name",
  });

export type IngredientLine = z.infer<typeof ingredientLine>;

const ingredients = z.array(ingredientLine).max(RECIPE_MAX_INGREDIENTS);

export const createRecipeSchema = z
  .object({
    // Old strict readers refuse this payload before creating anything. A new
    // client must not retry a keyed create against an older key-ignorant route.
    creation_protocol: z.literal("herewoven.recipe-create.v1").optional(),
    creation_owner: recipeOwnerSchema.optional(),
    creation_issued_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    source_url: recipeSourceField.nullable().optional(),
    source_copy: z.boolean().optional(),
    title: z.string().trim().min(1).max(200),
    description: optionalText(2000),
    instructions: optionalText(20000),
    prep_time: minutes,
    cook_time: minutes,
    servings: z.number().int().min(1).max(100).optional(),
    ingredients: ingredients.optional(),
  })
  .strict()
  .refine(value => (value.creation_owner === undefined && value.creation_issued_at === undefined) ||
    (value.creation_owner !== undefined && value.creation_issued_at !== undefined && value.creation_protocol === "herewoven.recipe-create.v1"), {
    message: "Recipe owner and original issue time require the create protocol",
  });

export const RECIPE_EDIT_PROTOCOL = "herewoven.recipe-edit.v1";
export const updateRecipeSchema = z
  .object({
    // The previous strict schema rejects these fields before any edit effects.
    edit_protocol: z.literal(RECIPE_EDIT_PROTOCOL).optional(),
    edit_owner: recipeOwnerSchema.optional(),
    base_revision: z.number().int().nonnegative().optional(),
    base_updated_at: z.string().datetime().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: optionalText(2000),
    instructions: optionalText(20000),
    prep_time: minutes,
    cook_time: minutes,
    servings: z.number().int().min(1).max(100).optional(),
    /** When present, replaces the recipe's whole ingredient set. */
    ingredients: ingredients.optional(),
  })
  .strict()
  .refine(value => (value.edit_protocol === undefined && value.edit_owner === undefined) ||
    (value.edit_protocol !== undefined && value.edit_owner !== undefined), {
    message: "Recipe edit owner and protocol must be supplied together",
  });
