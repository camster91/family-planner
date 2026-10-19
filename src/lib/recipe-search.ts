import { z } from "zod";
import type { Prisma } from "@prisma/client";

const number = (max: number) =>
  z.coerce.number().int().min(1).max(max).optional();
export const recipeSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  ingredient: z.string().trim().max(100).optional(),
  maxPrep: number(1440),
  minServings: number(100),
  favorite: z.enum(["1"]).optional(),
  collection: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export type RecipeSearch = z.infer<typeof recipeSearchSchema>;
/** Full household library search, independent of publisher/AI availability. */
export function recipeSearchWhere(
  familyId: string,
  input: RecipeSearch,
): Prisma.RecipeWhereInput {
  const q = input.q?.normalize("NFC");
  const ingredient = input.ingredient?.normalize("NFC");
  return {
    family_id: familyId,
    ...(input.favorite ? { favorite: true } : {}),
    ...(input.collection
      ? {
          collection_entries: {
            some: { collection_id: input.collection, family_id: familyId },
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(ingredient
      ? {
          ingredients: {
            some: {
              ingredient: {
                family_id: familyId,
                name: { contains: ingredient, mode: "insensitive" },
              },
            },
          },
        }
      : {}),
    ...(input.maxPrep !== undefined
      ? { prep_time: { lte: input.maxPrep } }
      : {}),
    ...(input.minServings !== undefined
      ? { servings: { gte: input.minServings } }
      : {}),
  };
}
