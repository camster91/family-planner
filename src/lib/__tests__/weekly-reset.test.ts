/** Source cases for the provider-free review contract; execution deferred. */
import { defaultFeatures } from "@/lib/features";
import {
  WEEKLY_RESET_PROTOCOL,
  weeklyResetCommand,
  weeklyResetScope,
  weeklyResetRecord,
  weeklyResetSections,
  planWeeklyReset,
} from "../weekly-reset";
const features = defaultFeatures();
const base = {
  protocol: WEEKLY_RESET_PROTOCOL,
  familyId: "family-a",
  weekStart: "2026-10-19",
  timeZone: "America/Toronto",
  expectedRevision: 0,
};
it("requires a real Monday/zone, known protocol, owned scope and bounded revision", () => {
  expect(
    weeklyResetCommand.safeParse({ ...base, action: "start" }).success,
  ).toBe(true);
  for (const patch of [
    { weekStart: "2026-10-20" },
    { weekStart: "2026-02-30" },
    { timeZone: "Not/A_Zone" },
    { protocol: "future" },
    { expectedRevision: -1 },
    { extra: "household content" },
  ]) {
    expect(
      weeklyResetCommand.safeParse({ ...base, ...patch, action: "start" })
        .success,
    ).toBe(false);
  }
  expect(
    weeklyResetScope.safeParse({
      weekStart: base.weekStart,
      timeZone: base.timeZone,
      familyId: "foreign",
    }).success,
  ).toBe(false);
});
it("requires explicit Start for a different review scope and keeps same-scope Start", () => {
  const started = planWeeklyReset(
    null,
    { ...base, action: "start" },
    "parent",
    features,
    new Date(),
  );
  expect(
    planWeeklyReset(
      started,
      { ...base, action: "start" },
      "parent",
      features,
      new Date(),
    ),
  ).toBe(started);
  expect(() =>
    planWeeklyReset(
      started,
      {
        ...base,
        weekStart: "2026-10-26",
        action: "set-step",
        step: "schedule",
        state: "reviewed",
      },
      "parent",
      features,
      new Date(),
    ),
  ).toThrow("SCOPE_CHANGED");
  const next = planWeeklyReset(
    started,
    { ...base, weekStart: "2026-10-26", action: "start" },
    "parent",
    features,
    new Date(),
  );
  expect(next.weekStart).toBe("2026-10-26");
  expect(next.steps).toEqual({});
});
it("finishes only a handled permitted review; skip is not household task completion", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  let record = planWeeklyReset(
    null,
    { ...base, action: "start" },
    "parent",
    features,
    now,
  );
  expect(() =>
    planWeeklyReset(
      record,
      { ...base, action: "finish" },
      "parent",
      features,
      now,
    ),
  ).toThrow("INCOMPLETE");
  for (const section of weeklyResetSections("parent", features))
    record = planWeeklyReset(
      record,
      {
        ...base,
        action: "set-step",
        step: section.id,
        state: section.id === "schedule" ? "reviewed" : "skipped",
      },
      "parent",
      features,
      now,
    );
  const finished = planWeeklyReset(
    record,
    { ...base, action: "finish" },
    "parent",
    features,
    now,
  );
  expect(finished.finishedAt).toBe(now.toISOString());
  expect(weeklyResetRecord.safeParse(finished).success).toBe(true);
  const edited = planWeeklyReset(
    finished,
    { ...base, action: "set-step", step: "schedule", state: "pending" },
    "parent",
    features,
    now,
  );
  expect(edited.finishedAt).toBeNull();
  expect(edited.steps.groceries).toBe("skipped");
  expect(Object.keys(edited).sort()).toEqual([
    "familyId",
    "finishedAt",
    "protocol",
    "steps",
    "timeZone",
    "weekStart",
  ]);
});
it("filters child and feature-off steps without implying account authority for profiles", () => {
  const child = weeklyResetSections("child", features);
  expect(child.find((row) => row.id === "schedule")?.href).toBe(
    "/dashboard/today",
  );
  expect(child.some((row) => row.id === "meals" || row.id === "prep")).toBe(
    false,
  );
  expect(weeklyResetSections("unknown", features)).toEqual([]);
  const record = planWeeklyReset(
    null,
    { ...base, action: "start" },
    "child",
    features,
    new Date(),
  );
  expect(() =>
    planWeeklyReset(
      record,
      { ...base, action: "set-step", step: "meals", state: "reviewed" },
      "child",
      features,
      new Date(),
    ),
  ).toThrow("STEP_UNAVAILABLE");
  expect(
    weeklyResetSections("parent", { ...features, meals: false }).some(
      (row) => row.id === "prep",
    ),
  ).toBe(false);
});
