/** Bounded canonical recipe presence review. Never estimates quantities or writes a list. */
import type { Prisma } from "@prisma/client";
import { toDateOnlyUTC } from "@/lib/dates";
import {
  loadCookInventory,
  indexCookInventory,
  matchRecipeIngredients,
} from "@/lib/inventory";
import type { WeeklyResetSummary } from "@/lib/weekly-reset-summary-contract";
const CAP = 8;
const text = (value: string) =>
  Array.from(value.normalize("NFC")).slice(0, 240).join("");
export async function weeklyRecipeGaps(
  tx: Prisma.TransactionClient,
  familyId: string,
  dateStart: Date,
  dateEnd: Date,
  today: Date,
): Promise<{
  group: WeeklyResetSummary["groups"][number];
  incomplete: boolean;
}> {
  const meals = await tx.familyMeal.findMany({
    where: {
      family_id: familyId,
      date: { gte: dateStart, lt: dateEnd },
      // A prepared dish is food already cooked, not a new ingredient demand.
      OR: [
        { batch_id: null },
        {
          batch: {
            is: {
              family_id: familyId,
              prep_session: { is: { family_id: familyId, prepared_at: null } },
            },
          },
        },
      ],
    },
    select: { recipe_id: true, date: true },
    orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
    take: CAP + 1,
  });
  const selected = meals.slice(0, CAP);
  let incomplete =
    meals.length > CAP || selected.some((row) => row.recipe_id === null);
  const ids = [
    ...new Set(
      selected.flatMap((row) => (row.recipe_id ? [row.recipe_id] : [])),
    ),
  ];
  const group: WeeklyResetSummary["groups"][number] = {
    kind: "gaps",
    rows: [],
    compared: 0,
    more: meals.length > CAP,
  };
  if (!ids.length) return { group: { ...group, incomplete }, incomplete };
  const recipes = await tx.recipe.findMany({
    where: { family_id: familyId, id: { in: ids } },
    select: {
      id: true,
      title: true,
      ingredients: {
        orderBy: { ingredient_id: "asc" },
        take: 101,
        select: {
          ingredient: { select: { id: true, name: true, family_id: true } },
        },
      },
    },
    take: CAP,
  });
  const stock = await loadCookInventory(tx, familyId, {
    from: dateStart > today ? dateStart : today,
    cap: 500,
  });
  if (stock.truncated)
    return {
      group: { ...group, more: true, incomplete: true },
      incomplete: true,
    };
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const seen = new Set<string>();
  for (const meal of selected) {
    if (!meal.recipe_id) continue;
    const recipe = byId.get(meal.recipe_id);
    if (
      !recipe ||
      !recipe.ingredients.length ||
      recipe.ingredients.length > 100 ||
      recipe.ingredients.some((row) => row.ingredient.family_id !== familyId)
    ) {
      incomplete = true;
      continue;
    }
    // Past meal dates cannot make currently expired food appear available.
    const day = meal.date > today ? meal.date : today;
    group.compared = (group.compared ?? 0) + 1;
    const missing = matchRecipeIngredients(
      recipe.ingredients,
      indexCookInventory(stock.items, day),
    ).missing;
    for (const item of missing) {
      const key = JSON.stringify([recipe.id, item.ingredientId]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (group.rows.length >= CAP) {
        group.more = true;
        continue;
      }
      group.rows.push({
        title: text(item.name),
        when: toDateOnlyUTC(meal.date),
        sourceTitle: text(recipe.title),
        href: `/dashboard/meals/recipes/${encodeURIComponent(recipe.id)}`,
      });
    }
  }
  return { group: { ...group, incomplete }, incomplete };
}
