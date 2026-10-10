import { WEEKDAYS } from "./chore-weekdays";
import type { Chore } from "@/types";

/** Series identity, not matching titles, decides which occurrences belong together. */
export function groupChoreSeries<T extends Chore>(
  chores: T[],
): { key: string; steps: T[]; repeating: boolean }[] {
  const groups = new Map<
    string,
    { key: string; steps: T[]; repeating: boolean }
  >();
  for (const chore of chores) {
    const repeating = Boolean(chore.recurrence_id);
    const key = JSON.stringify([
      chore.family_id,
      repeating ? "series" : "chore",
      chore.recurrence_id || chore.id,
    ]);
    const group = groups.get(key);
    if (group) group.steps.push(chore);
    else groups.set(key, { key, steps: [chore], repeating });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    steps: [...group.steps].sort(
      (a, b) =>
        a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id),
    ),
  }));
}

export function choreCadence(chore: Chore): string {
  const frequency = chore.recurrence_frequency ?? chore.frequency;
  if (frequency === "weekly") {
    const days = chore.recurrence_weekly_days ?? chore.weekly_days ?? [];
    const names = WEEKDAYS.filter((d) => days.includes(d.day)).map(
      (d) => d.label,
    );
    return names.length ? `Weekly · ${names.join(", ")}` : "Weekly";
  }
  if (frequency === "daily") return "Daily";
  if (frequency === "monthly") return "Monthly";
  return "Repeating";
}
