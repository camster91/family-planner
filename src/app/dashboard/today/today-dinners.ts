/** Bounded, glanceable dinner preview per UTC date; Meals owns the full collection. */
import type { PrismaClient } from "@prisma/client";
import { addUTCDays } from "@/lib/dates";
import { COMING_UP_DAYS } from "@/lib/board-constants";
export const BOARD_DINNER_INGREDIENT_MAX = 200;
export interface DinnerRow {
  id: string;
  date: Date;
  recipe_name: string | null;
  cook: { name: string } | null;
  recipe: {
    title: string;
    prep_time: number | null;
    ingredients?: Array<{
      ingredient: { id: string; name: string; family_id?: string };
    }>;
  } | null;
  hasMoreDinners: boolean;
}
export async function loadBoardDinners(
  db: Pick<PrismaClient, "familyMeal">,
  familyId: string,
  start: Date,
  end: Date,
  withMissing: boolean,
): Promise<DinnerRow[]> {
  const days = (end.getTime() - start.getTime()) / 86400000;
  if (!Number.isInteger(days) || days < 1 || days > COMING_UP_DAYS + 3)
    throw new Error("Invalid board dinner window");
  // Fixed display-day fanout, never a loop over household records. Two rows
  // prove whether another dinner exists without counting/hydrating all meals.
  const previews = await Promise.all(
    Array.from({ length: days }, async (_, index) => {
      const day = addUTCDays(start, index);
      const rows = await db.familyMeal.findMany({
        where: {
          family_id: familyId,
          meal_type: "dinner",
          date: { gte: day, lt: addUTCDays(day, 1) },
        },
        select: {
          id: true,
          date: true,
          recipe_name: true,
          cook: { select: { name: true, family_id: true } },
          recipe: {
            select: {
              title: true,
              prep_time: true,
              family_id: true,
              ...(withMissing
                ? {
                    ingredients: {
                      select: {
                        ingredient: {
                          select: { id: true, name: true, family_id: true },
                        },
                      },
                      orderBy: { id: "asc" as const },
                      take: BOARD_DINNER_INGREDIENT_MAX + 1,
                    },
                  }
                : {}),
            },
          },
        },
        orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
        take: 2,
      });
      const first = rows[0];
      if (!first) return null;
      return {
        id: first.id,
        date: first.date,
        recipe_name: first.recipe_name,
        cook:
          first.cook?.family_id === familyId ? { name: first.cook.name } : null,
        recipe: first.recipe?.family_id === familyId ? first.recipe : null,
        hasMoreDinners: rows.length > 1,
      } satisfies DinnerRow;
    }),
  );
  return previews.filter((row): row is NonNullable<typeof row> => row !== null);
}
