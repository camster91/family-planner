/**
 * Canonical recipe write path (ADR-0007, #251).
 *
 * `Recipe`, `Ingredient` and `RecipeIngredient` are the only recipe models.
 * `/api/recipes[/id]` validates bodies here and resolves nested ingredients:
 *
 * - `{ ingredient_id, amount, ... }` must name an `Ingredient` of the caller's
 *   household. A foreign or missing id is the same 400, so the response never
 *   reveals whether another household's ingredient exists.
 * - `{ name, amount, ... }` is upserted by (family, normalized name): an
 *   existing same-family ingredient whose name normalises equal (NFC, trimmed,
 *   inner whitespace collapsed, case-insensitive) is reused; otherwise one is
 *   created with the cleaned display name.
 *
 * Roles (O-7): parent and teen create/edit, parent deletes, child reads.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeName } from "@/lib/backfill/meals-groceries";

import type { IngredientLine } from "@/lib/recipe-input-contract";
export {
  RECIPE_MAX_INGREDIENTS,
  createRecipeSchema,
  updateRecipeSchema,
  type IngredientLine,
} from "@/lib/recipe-input-contract";

export function canEditRecipe(role: string | undefined | null): boolean {
  return role === "parent" || role === "teen";
}

export function canDeleteRecipe(role: string | undefined | null): boolean {
  return role === "parent";
}

/** Summary fields for list views and meal links. */
export const RECIPE_SUMMARY_SELECT = {
  id: true,
  title: true,
  description: true,
  prep_time: true,
  cook_time: true,
  servings: true,
  image_url: true,
  source_url: true,
  favorite: true,
  revision: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

/** Full recipe with nested ingredients (never another household's rows: owned through the recipe). */
export const RECIPE_DETAIL_SELECT = {
  ...RECIPE_SUMMARY_SELECT,
  instructions: true,
  ingredients: {
    // Existing fields only: DB collation name order, then stable ingredient ID,
    // then join ID. Input array position is NOT an authored/persisted sequence.
    orderBy: [
      { ingredient: { name: "asc" } },
      { ingredient_id: "asc" },
      { id: "asc" },
    ] satisfies Prisma.RecipeIngredientOrderByWithRelationInput[],
    select: {
      id: true,
      amount: true,
      unit: true,
      note: true,
      ingredient: { select: { id: true, name: true, unit: true } },
    },
  },
} as const;

/** The meal-side summary (`GET /api/meals` `recipe`). */
export const MEAL_RECIPE_SELECT = {
  id: true,
  title: true,
  prep_time: true,
  cook_time: true,
  servings: true,
} as const;

/** Display form of an ingredient name: NFC, trimmed, inner whitespace collapsed. */
export function cleanIngredientName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

export class RecipeInputError extends Error {}

type Tx =
  Pick<PrismaClient, "ingredient" | "$queryRaw"> | Prisma.TransactionClient;

/**
 * Serialise ingredient creation by name within one household. The unique
 * constraint is on the display name, so two concurrent writes of `Sugar` and
 * `sugar` would otherwise both miss each other and create two ingredients.
 * Held until the surrounding transaction ends.
 */
export async function lockFamilyIngredientNames(
  tx: Tx,
  familyId: string,
): Promise<void> {
  const key = `ingredient-names:${familyId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
}

export interface ResolvedLine {
  ingredient_id: string;
  amount: number;
  unit: string | null;
  note: string | null;
}

/**
 * Resolve every line to a same-family ingredient id, creating missing
 * ingredients by name. Throws `RecipeInputError` (a 400 with a generic
 * message) for a foreign/missing `ingredient_id` or a duplicate ingredient.
 */
export async function resolveIngredientLines(
  tx: Tx,
  familyId: string,
  lines: readonly IngredientLine[],
): Promise<ResolvedLine[]> {
  if (lines.length === 0) return [];
  const ids = [
    ...new Set(
      lines
        .map((l) => l.ingredient_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length > 0) {
    const owned = await tx.ingredient.findMany({
      where: { id: { in: ids }, family_id: familyId },
      select: { id: true },
    });
    if (owned.length !== ids.length)
      throw new RecipeInputError("Ingredient not found");
  }

  const neededNames = new Set(lines.flatMap(line => line.name ? [normalizeName(line.name)] : []));
  const byName = new Map<string, string>();
  if (neededNames.size) {
    // Take the lock before reading so a concurrent writer's new ingredient is
    // visible here (READ COMMITTED re-reads after the lock is granted).
    await lockFamilyIngredientNames(tx, familyId);
    // Preserve the canonical JavaScript Unicode/whitespace comparison instead
    // of approximating it with SQL lower/ILIKE. Hold only one catalog batch and
    // the requested matches; a missing name may still require a complete scan.
    let afterId: string | undefined;
    while (neededNames.size) {
      const batch = await tx.ingredient.findMany({
        where: { family_id: familyId, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" }, take: 500,
        select: { id: true, name: true },
      });
      for (const ingredient of batch) {
        const key = normalizeName(ingredient.name);
        if (neededNames.delete(key)) byName.set(key, ingredient.id);
      }
      if (!neededNames.size || batch.length < 500) break;
      const nextId = batch[batch.length - 1].id;
      if (nextId === afterId) throw new RecipeInputError("Ingredient catalog could not be read");
      afterId = nextId;
    }
  }

  const out: ResolvedLine[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let ingredientId = line.ingredient_id;
    if (!ingredientId) {
      const display = cleanIngredientName(line.name!);
      const key = normalizeName(display);
      ingredientId = byName.get(key);
      if (!ingredientId) {
        const created = await tx.ingredient.upsert({
          where: { family_id_name: { family_id: familyId, name: display } },
          update: {},
          create: {
            family_id: familyId,
            name: display,
            unit: line.unit ?? null,
          },
          select: { id: true },
        });
        ingredientId = created.id;
        byName.set(key, ingredientId);
      }
    }
    if (seen.has(ingredientId))
      throw new RecipeInputError(
        "Each ingredient may appear only once in a recipe",
      );
    seen.add(ingredientId);
    out.push({
      ingredient_id: ingredientId,
      amount: line.amount,
      unit: line.unit ?? null,
      note: line.note ?? null,
    });
  }
  return out;
}
