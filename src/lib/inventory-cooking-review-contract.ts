/** Read-only recipe/prep context. Amounts never authorize inventory writes. */
import { z } from "zod";
const id = z.string().min(1).max(128);
export const cookingReviewSource = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("recipe"),
      id,
      servings: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("batch"), id }).strict(),
]);
export type CookingReviewSource = z.infer<typeof cookingReviewSource>;
export const cookingReview = z
  .object({
    userId: id,
    familyId: id,
    source: cookingReviewSource,
    title: z.string().min(1).max(200),
    basis: z.enum(["current-recipe", "prepared-snapshot"]),
    baseServings: z.number().int().min(1).max(100),
    targetServings: z.number().int().min(1).max(100),
    lines: z
      .array(
        z
          .object({
            id,
            ingredientId: id,
            name: z.string().min(1).max(200),
            amount: z.number().finite().min(0).max(100000),
            unit: z.string().max(32).nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
