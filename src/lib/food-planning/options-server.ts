/** Person/household-scoped read selectors. Never a provider catalog or write tool. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeFoodWriteInTx } from "./persist";
import {
  foodPlanningEnabled,
  FoodPlanningUnavailable,
  type FoodPlanActor,
} from "./server";
import {
  FOOD_OPTIONS,
  FOOD_OPTIONS_PAGE,
  foodOptionsQuery,
  foodOptionsReply,
  type FoodOptionsQuery,
  type FoodOption,
} from "./options-contract";
async function records(
  tx: Prisma.TransactionClient,
  actor: FoodPlanActor,
  query: FoodOptionsQuery,
  selected: boolean,
): Promise<FoodOption[]> {
  const ids = selected ? { id: { in: query.selectedIds } } : {};
  const page: { take: number; skip?: number } = selected
    ? { take: 50 }
    : { skip: query.offset, take: FOOD_OPTIONS_PAGE + 1 };
  if (selected && !query.selectedIds.length) return [];
  const search =
    !selected && query.search
      ? { contains: query.search, mode: "insensitive" as const }
      : undefined;
  if (query.kind === "recipes") {
    const rows = await tx.recipe.findMany({
      where: {
        family_id: actor.familyId,
        ...ids,
        ...(search ? { title: search } : {}),
      },
      select: {
        id: true,
        title: true,
        servings: true,
        prep_time: true,
        cook_time: true,
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      ...page,
    });
    return rows.map((row) => ({
      kind: "recipe",
      id: row.id,
      title: row.title,
      servings: row.servings,
      minutes:
        row.prep_time === null || row.cook_time === null
          ? null
          : row.prep_time + row.cook_time,
    }));
  }
  if (query.kind === "people") {
    const rows = await tx.user.findMany({
      where: {
        family_id: actor.familyId,
        ...ids,
        ...(search ? { name: search } : {}),
      },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...page,
    });
    return rows.map((row) => ({ ...row, kind: "person" }));
  }
  if (query.kind === "lists") {
    const rows = await tx.list.findMany({
      where: {
        family_id: actor.familyId,
        type: { in: ["grocery", "shopping"] },
        ...ids,
        ...(search ? { name: search } : {}),
      },
      select: { id: true, name: true, type: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...page,
    });
    return rows.map((row) => ({
      ...row,
      kind: "list",
      type: row.type as "grocery" | "shopping",
    }));
  }
  const rows = await tx.event.findMany({
    where: {
      family_id: actor.familyId,
      ...ids,
      ...(!selected
        ? {
            start_time: {
              gte: new Date(query.range!.start),
              lte: new Date(query.range!.end),
            },
          }
        : {}),
      ...(search ? { title: search } : {}),
    },
    select: {
      id: true,
      title: true,
      start_time: true,
      end_time: true,
      recurrence: true,
    },
    orderBy: [{ start_time: "asc" }, { id: "asc" }],
    ...page,
  });
  return rows.map((row) => ({
    kind: "departure",
    id: row.id,
    title: row.title,
    start: row.start_time.toISOString(),
    end: row.end_time.toISOString(),
    repeating: row.recurrence !== null,
  }));
}
export function readFoodOptions(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  raw: FoodOptionsQuery,
) {
  const query = foodOptionsQuery.parse(raw);
  if (!foodPlanningEnabled()) throw new FoodPlanningUnavailable();
  return db.$transaction(
    async (tx) => {
      await authorizeFoodWriteInTx(tx, actor);
      const items = await records(tx, actor, query, false),
        selected = await records(tx, actor, query, true);
      if (
        selected.length !== query.selectedIds.length ||
        !foodPlanningEnabled()
      )
        throw new FoodPlanningUnavailable();
      return foodOptionsReply.parse({
        protocol: FOOD_OPTIONS,
        owner: actor,
        query,
        items: items.slice(0, FOOD_OPTIONS_PAGE),
        selected,
        hasMore: items.length > FOOD_OPTIONS_PAGE,
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
