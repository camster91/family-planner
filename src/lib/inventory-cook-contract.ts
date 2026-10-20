/** Additive, bounded HTTP reader for recipe presence hints. Never a stock reservation. */
import { z } from "zod";
const id = z.string().min(1).max(128);
const ingredient = z.object({
  ingredientId: id,
  name: z.string().min(1).max(200),
  match: z.enum(["linked", "name"]).optional(),
});
export const cookSuggestionSchema = z
  .object({
    recipeId: id,
    title: z.string().min(1).max(200),
    prep_time: z.number().finite().nonnegative().nullable(),
    cook_time: z.number().finite().nonnegative().nullable(),
    servings: z.number().int().min(1).max(100),
    totalCount: z.number().int().min(1).max(100),
    haveCount: z.number().int().min(1).max(100),
    missingCount: z.number().int().min(0).max(100),
    coverage: z.number().min(0).max(1),
    useSoonCount: z.number().int().min(0).max(100),
    have: z.array(ingredient).min(1).max(100),
    missing: z.array(ingredient).max(100),
  })
  .refine(
    (row) =>
      row.have.length === row.haveCount &&
      row.missing.length === row.missingCount &&
      row.totalCount === row.haveCount + row.missingCount &&
      row.useSoonCount <= row.haveCount &&
      Math.abs(
        row.coverage - Math.round((row.haveCount / row.totalCount) * 100) / 100,
      ) < 0.0001 &&
      new Set([...row.have, ...row.missing].map((item) => item.ingredientId))
        .size === row.totalCount,
  );
export const cookSuggestionsSchema = z
  .object({
    suggestions: z.array(cookSuggestionSchema).max(50),
    recipesConsidered: z.number().int().nonnegative().max(10000),
    truncated: z.boolean(),
    inputsTruncated: z.boolean().optional(),
    matching: z.literal("presence_only").optional(),
    comparisonIncomplete: z.boolean().optional(),
  })
  .refine(
    (data) =>
      new Set(data.suggestions.map((row) => row.recipeId)).size ===
      data.suggestions.length,
  );
