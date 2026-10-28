/** One shared legacy date-window rule for PostgreSQL and native D1. */
import { nextDueDate, startOfDay } from "./chore-recurrence-dates";
import { normalizedWeekdays } from "./chore-weekdays";
export function choreExpansionWindowSize(
  frequency: string,
  weeklyDays: readonly number[],
) {
  const size =
    frequency === "daily"
      ? 7
      : frequency === "weekly"
        ? 4
        : frequency === "monthly"
          ? 3
          : 0;
  return (
    size *
    (frequency === "weekly"
      ? Math.max(1, normalizedWeekdays(weeklyDays).length)
      : 1)
  );
}
export function choreExpansionDays(
  root: { frequency: string; weekly_days: number[]; due_date: Date },
  upcoming: readonly { due_date: Date }[],
  latest: { due_date: Date } | null,
  now: Date,
) {
  const size = choreExpansionWindowSize(root.frequency, root.weekly_days),
    needed = size - upcoming.length;
  if (size === 0 || needed <= 0) return [];
  const today = startOfDay(now),
    first = startOfDay(root.due_date),
    anchor = first.getUTCDate();
  let horizon = first > today ? first : today;
  for (let i = 0; i < size; i++) {
    const next = nextDueDate(horizon, root.frequency, root.weekly_days, anchor);
    if (!next) return [];
    horizon = next;
  }
  const occupied = new Set(upcoming.map((row) => row.due_date.getTime())),
    days: Date[] = [];
  let cursor = nextDueDate(
    latest?.due_date ?? root.due_date,
    root.frequency,
    root.weekly_days,
    anchor,
  );
  while (cursor && cursor < horizon && days.length < needed) {
    if (cursor >= today && !occupied.has(cursor.getTime())) days.push(cursor);
    cursor = nextDueDate(cursor, root.frequency, root.weekly_days, anchor);
  }
  return days;
}
