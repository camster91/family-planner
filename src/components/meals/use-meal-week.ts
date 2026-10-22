"use client";
import * as React from "react";
import { toDateOnlyLocal } from "@/lib/dates";
import { getWeekDates, type PlannedMeal } from "@/lib/meal-slots";
import { MEAL_PAGE_SIZE, mealListPageSchema } from "@/lib/meal-paging-contract";

class MealReadError extends Error {
  constructor(readonly status: number) {
    super("Meal page unavailable");
  }
}
type Paging = {
  anchor: Date | null;
  nextCursor: string | null;
  pages: number;
  used: Set<string>;
  busy: boolean;
};
const initialPaging = (): Paging => ({
  anchor: null,
  nextCursor: null,
  pages: 0,
  used: new Set(),
  busy: false,
});
function rangeParams(anchor: Date) {
  const days = getWeekDates(anchor),
    end = new Date(days[days.length - 1]);
  end.setDate(end.getDate() + 1);
  return new URLSearchParams({
    start: toDateOnlyLocal(days[0]),
    end: toDateOnlyLocal(end),
    limit: String(MEAL_PAGE_SIZE),
  });
}
async function readPage(
  anchor: Date,
  cursor: string | null,
  signal: AbortSignal,
) {
  const params = rangeParams(anchor);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/meals?${params}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new MealReadError(response.status);
  const page = mealListPageSchema.parse(await response.json());
  if (
    page.meals.length > MEAL_PAGE_SIZE ||
    new Set(page.meals.map((meal) => meal.id)).size !== page.meals.length ||
    page.meals.some(
      (meal) =>
        meal.date < `${params.get("start")}T00:00:00.000Z` ||
        meal.date >= `${params.get("end")}T00:00:00.000Z`,
    ) ||
    (page.nextCursor && (!page.meals.length || page.nextCursor === cursor))
  )
    throw new MealReadError(502);
  return page;
}
/** One bounded read per explicit page. Refresh only the depth already requested;
 * changing weeks starts over. A superseded range can never replace/append rows.
 */
export function useMealWeek(anchor: Date | null, errorMessage: string) {
  const [meals, setMeals] = React.useState<PlannedMeal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreFailed, setMoreFailed] = React.useState(false);
  const selected = React.useRef(anchor);
  const version = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const paging = React.useRef<Paging>(initialPaging());
  React.useLayoutEffect(() => {
    selected.current = anchor;
    // Never paint the previous week's completeness/rows under a new heading.
    setMeals([]);
    setLoading(Boolean(anchor));
    setFailed(false);
    setHasMore(false);
    setLoadingMore(false);
    setMoreFailed(false);
    return () => {
      selected.current = null;
      version.current++;
      controller.current?.abort();
    };
  }, [anchor]);
  const refresh = React.useCallback(async () => {
    const requestAnchor = selected.current;
    if (!requestAnchor) return;
    const depth =
      paging.current.anchor === requestAnchor
        ? Math.max(1, paging.current.pages)
        : 1;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const request = ++version.current;
    const current = () =>
      version.current === request && selected.current === requestAnchor;
    const next: Paging = {
      ...initialPaging(),
      anchor: requestAnchor,
      busy: true,
    };
    paging.current = next;
    setLoading(true);
    setFailed(false);
    setMoreFailed(false);
    setLoadingMore(false);
    setHasMore(false);
    try {
      const loaded = new Map<string, PlannedMeal>();
      for (let index = 0; index < depth; index++) {
        const cursor = next.nextCursor;
        const page = await readPage(requestAnchor, cursor, pending.signal);
        if (!current()) return;
        if (cursor) next.used.add(cursor);
        if (page.nextCursor && next.used.has(page.nextCursor))
          throw new MealReadError(502);
        page.meals.forEach((meal) => loaded.set(meal.id, meal));
        next.nextCursor = page.nextCursor;
        next.pages++;
        if (!page.nextCursor) break;
      }
      if (current()) {
        setMeals([...loaded.values()]);
        setHasMore(Boolean(next.nextCursor));
      }
    } catch {
      if (current()) {
        setMeals([]);
        setFailed(true);
        next.nextCursor = null;
      }
    } finally {
      if (current()) {
        next.busy = false;
        setLoading(false);
      }
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [anchor, refresh]);
  const loadMore = React.useCallback(async () => {
    const requestAnchor = selected.current,
      next = paging.current;
    if (
      !requestAnchor ||
      next.anchor !== requestAnchor ||
      next.busy ||
      !next.nextCursor
    )
      return;
    const cursor = next.nextCursor;
    next.busy = true;
    const pending = new AbortController();
    controller.current = pending;
    const request = ++version.current;
    const current = () =>
      version.current === request &&
      selected.current === requestAnchor &&
      paging.current === next;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await readPage(requestAnchor, cursor, pending.signal);
      if (!current()) return;
      if (page.nextCursor && next.used.has(page.nextCursor))
        throw new MealReadError(502);
      next.used.add(cursor);
      next.pages++;
      next.nextCursor = page.nextCursor;
      setMeals((previous) => [
        ...new Map<string, PlannedMeal>(
          [...previous, ...page.meals].map((meal) => [meal.id, meal]),
        ).values(),
      ]);
      setHasMore(Boolean(page.nextCursor));
    } catch (error) {
      if (!current()) return;
      if (
        error instanceof MealReadError &&
        [400, 401, 403].includes(error.status)
      ) {
        // A changed owner/role/feature or rejected range must not leave private
        // rows visible as a usable current snapshot. Ordinary outages retain it.
        next.nextCursor = null;
        setMeals([]);
        setHasMore(false);
        setFailed(true);
      } else setMoreFailed(true);
    } finally {
      if (current()) {
        next.busy = false;
        setLoadingMore(false);
      }
    }
  }, []);
  return {
    meals,
    loading,
    error: failed ? errorMessage : null,
    hasMore,
    loadingMore,
    moreFailed,
    pageCount: paging.current.pages,
    refresh,
    loadMore,
  };
}
