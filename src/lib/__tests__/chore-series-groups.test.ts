import { groupChoreSeries, choreCadence } from "../chore-series-groups";
import type { Chore } from "@/types";
const row = (id: string, extra: Partial<Chore> = {}): Chore => ({
  id,
  family_id: "f",
  title: "Trash",
  assigned_to: "adult",
  due_date: "2026-10-15",
  points: 0,
  status: "pending",
  frequency: "once",
  difficulty: "easy",
  created_at: "2026-10-01",
  ...extra,
});
it("combines only canonical series in the same household, not matching titles", () => {
  const groups = groupChoreSeries([
    row("later", { recurrence_id: "t", due_date: "2026-10-22" }),
    row("first", { recurrence_id: "t" }),
    row("another", { recurrence_id: "other" }),
    row("foreign", { family_id: "other-family", recurrence_id: "t" }),
    row("one-off"),
    row("one-off-2"),
  ]);
  expect(groups).toHaveLength(5);
  expect(groups[0].steps.map((c) => c.id)).toEqual(["first", "later"]);
  expect(groups[3].repeating).toBe(false);
});
it("uses template cadence for one-off copies, including selected weekdays", () => {
  expect(
    choreCadence(
      row("c", {
        recurrence_id: "t",
        recurrence_frequency: "weekly",
        recurrence_weekly_days: [4, 1],
      }),
    ),
  ).toBe("Weekly · Monday, Thursday");
  expect(choreCadence(row("c", { recurrence_frequency: "monthly" }))).toBe(
    "Monthly",
  );
  expect(choreCadence(row("c", { recurrence_frequency: "daily" }))).toBe(
    "Daily",
  );
  expect(choreCadence(row("c", { recurrence_id: "missing" }))).toBe(
    "Repeating",
  );
});
