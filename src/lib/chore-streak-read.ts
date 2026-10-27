/** Read-only badge projection; never materialize every completion or its title. */
import { Prisma, type PrismaClient } from "@prisma/client";
export const CHORE_STREAK_ASSIGNEE_BATCH = 200;
type Db = Pick<PrismaClient, "$queryRaw">;
type DayRow = { assigned_to: string; day: string };

/** Preserve the board's current server-local-midnight -> UTC-day key policy.
 * A household-timezone redesign is separate from this payload reduction.
 */
export function choreStreakDays(now: Date): string[] {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid streak date");
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    return day.toISOString().slice(0, 10);
  });
}

export async function readChoreStreaks(
  db: Db,
  familyId: string,
  visibleAssignees: readonly (string | null | undefined)[],
  now = new Date(),
): Promise<Record<string, number>> {
  const ids = [...new Set(visibleAssignees.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const streaks: Record<string, number> = Object.create(null);
  if (!ids.length) return streaks;
  const days = choreStreakDays(now);
  const allowedDays = new Set(days);
  const sortedDays = [...allowedDays].sort();
  const from = new Date(`${sortedDays[0]}T00:00:00.000Z`);
  const through = new Date(`${sortedDays[sortedDays.length - 1]}T00:00:00.000Z`);
  through.setUTCDate(through.getUTCDate() + 1);
  for (let offset = 0; offset < ids.length; offset += CHORE_STREAK_ASSIGNEE_BATCH) {
    const batch = ids.slice(offset, offset + CHORE_STREAK_ASSIGNEE_BATCH);
    // completed_at is TIMESTAMP(3), stored as UTC by the existing model/writer.
    // Group in PostgreSQL: at most seven markers per requested assignee,
    // regardless of how many chores were completed on each day.
    const rows = await db.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT "assigned_to", to_char("completed_at", 'YYYY-MM-DD') AS "day"
      FROM "Chore"
      WHERE "family_id"=${familyId} AND "assigned_to" IN (${Prisma.join(batch)})
        AND "status" IN ('completed', 'verified')
        AND "completed_at">=${from} AND "completed_at"<${through}
        AND to_char("completed_at", 'YYYY-MM-DD') IN (${Prisma.join([...allowedDays])})
      GROUP BY "assigned_to", to_char("completed_at", 'YYYY-MM-DD')
      LIMIT ${batch.length * allowedDays.size + 1}
    `);
    if (rows.length > batch.length * allowedDays.size)
      throw new Error("Streak projection exceeded its bound");
    const requested = new Set(batch);
    const byAssignee = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!requested.has(row.assigned_to) || !allowedDays.has(row.day))
        throw new Error("Invalid streak projection scope");
      const completed = byAssignee.get(row.assigned_to) ?? new Set<string>();
      if (completed.has(row.day)) throw new Error("Duplicate streak projection day");
      completed.add(row.day);
      byAssignee.set(row.assigned_to, completed);
    }
    for (const id of batch) {
      const completed = byAssignee.get(id);
      let streak = 0;
      for (const day of days) {
        if (!completed?.has(day)) break;
        streak++;
      }
      streaks[id] = streak >= 3 ? streak : 0;
    }
  }
  return streaks;
}
