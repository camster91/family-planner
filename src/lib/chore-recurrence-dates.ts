/** Shared pure UTC date arithmetic for canonical chores and routine schedules. */
import { normalizedWeekdays, nextSelectedWeekday } from "@/lib/chore-weekdays";

/** Month is zero-based; clamp this occurrence without changing its anchor. */
export function monthlyChoreDate(
  year: number,
  month: number,
  anchorDay: number,
): Date {
  const result = new Date(0);
  result.setUTCFullYear(year, month + 1, 0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(Math.min(anchorDay, result.getUTCDate()));
  return result;
}

/**
 * Next due date for one interval after `from`.
 *
 * Exported so the completion path in `/api/chores/complete` uses the SAME rule.
 * Previously the expander advanced monthly by `setDate(+30)` while completion
 * advanced by `setMonth(+1)`; across a month boundary those disagree (#184).
 */
export function nextDueDate(
  from: Date,
  frequency: string,
  weeklyDays: readonly number[] = [],
  monthlyAnchorDay = from.getUTCDate(),
): Date | null {
  // UTC throughout: due dates are stored as UTC midnight (the date pickers
  // send `YYYY-MM-DD`), so the result must not depend on the server's time
  // zone. Local `setHours`/`setDate` moved a UTC-midnight date to the
  // previous local day, and the next date landed on local midnight.
  const d = startOfDay(from);

  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case "weekly":
      if (normalizedWeekdays(weeklyDays).length)
        return nextSelectedWeekday(d, weeklyDays);
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case "monthly": {
      // Keep the template's day, clamping only this occurrence in short months.
      // Move from day 1 so JavaScript cannot overflow Jan 31 into March.
      return monthlyChoreDate(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        monthlyAnchorDay,
      );
    }
    default:
      return null;
  }
}

/** Midnight UTC of the same UTC calendar day. Due dates are stored at UTC midnight. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
