import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient, type NativeD1 } from "./read-client";
import { withChoreReads } from "@/lib/chore-read-scope";
import { readVisibleChoreRows } from "@/lib/chore-visible-read";
import { afterChoreCursor, choreOrderBy } from "@/lib/chore-paging";
import { hiddenD1RoutineOccurrenceIds } from "./chore-read-policy";
import { startOfTodayUTC, addUTCDays } from "@/lib/dates";
/** Bounded own-account missions; a profile never inherits a logged-in account. */
export async function readD1KidDashboardData(
  familyId: string,
  userId: string,
  now: Date,
  rewardsOn: boolean,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    native = store as unknown as NativeD1,
    today = startOfTodayUTC(now),
    from = addUTCDays(today, -1),
    through = addUTCDays(today, 2);
  const work = await withChoreReads(
    async (db) =>
      Promise.all([
        readVisibleChoreRows({
          take: 61,
          order: "asc",
          read: (after, take) =>
            db.chore.findMany({
              where: {
                family_id: familyId,
                assigned_to: userId,
                due_date: { gte: from, lte: through },
                ...(after ? afterChoreCursor(after, "asc") : {}),
              },
              orderBy: choreOrderBy("asc"),
              take,
            }),
          hidden: (ids) =>
            hiddenD1RoutineOccurrenceIds(familyId, { ids }, store),
        }),
        readVisibleChoreRows({
          take: 61,
          order: "desc",
          read: (after, take) =>
            db.chore.findMany({
              where: {
                family_id: familyId,
                assigned_to: userId,
                due_date: { lt: from },
                status: { in: ["pending", "in_progress", "overdue"] },
                ...(after ? afterChoreCursor(after, "desc") : {}),
              },
              orderBy: choreOrderBy("desc"),
              take,
            }),
          hidden: (ids) =>
            hiddenD1RoutineOccurrenceIds(familyId, { ids }, store),
        }),
      ]),
    native,
  );
  const [events, rewards] = await withD1ReadClient(
    (db) =>
      Promise.all([
        db.event.findMany({
          where: { family_id: familyId, start_time: { gte: now } },
          orderBy: { start_time: "asc" },
          take: 5,
          select: { id: true, title: true, start_time: true, location: true },
        }),
        rewardsOn
          ? db.reward.findMany({
              where: {
                family_id: familyId,
                status: "available",
                is_active: true,
              },
              orderBy: { created_at: "desc" },
              take: 5,
            })
          : Promise.resolve([]),
      ]),
    native,
  );
  return [work[0], work[1], events, rewards] as const;
}
