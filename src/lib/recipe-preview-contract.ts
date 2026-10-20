import { z } from "zod";
export const recipeImportIssue = z.enum([
  "title-shortened",
  "description-shortened",
  "ingredients-shortened",
  "directions-shortened",
  "servings-unknown",
  "prep-time-unknown",
  "cook-time-unknown",
  "ingredients-missing",
  "directions-missing",
]);
export type RecipeImportIssue = z.infer<typeof recipeImportIssue>;
const minutes = z.number().int().min(0).max(1440).nullable();
export const onlineRecipeSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(400),
    instructions: z.string().max(14000),
    ingredientLines: z.array(z.string().min(1).max(500)).max(100),
    source: z
      .string()
      .max(1500)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }),
    servings: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .default(null),
    prep_time: minutes,
    cook_time: minutes,
    reviewIssues: z.array(recipeImportIssue).max(9).optional(),
  })
  .strict();
export type OnlineRecipe = z.infer<typeof onlineRecipeSchema>;
/** Preserve all bounded extracted text for editing; never silently cut the saved draft. */
export function importedRecipeInstructions(
  recipe: OnlineRecipe,
  ingredientsLabel = "Ingredients",
): string {
  return `${recipe.ingredientLines.length ? `${ingredientsLabel}\n${recipe.ingredientLines.join("\n")}\n\n` : ""}${recipe.instructions}`;
}
export function recipeImportIssues(recipe: OnlineRecipe): RecipeImportIssue[] {
  const issues = new Set(recipe.reviewIssues ?? []);
  if (recipe.servings === null) issues.add("servings-unknown");
  if (recipe.prep_time === null) issues.add("prep-time-unknown");
  if (recipe.cook_time === null) issues.add("cook-time-unknown");
  if (!recipe.ingredientLines.length) issues.add("ingredients-missing");
  if (!recipe.instructions) issues.add("directions-missing");
  return [...issues];
}
