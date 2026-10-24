/** Authored for consolidated QA; no persistence or runtime activation. */
import {
  firstRoutineOccurrence,
  routineScheduleAnchorDay,
  nextRoutineOccurrence,
  normalizeRoutineSharedSchedule,
  routineResumeDay,
  routineScheduleCommand,
  routineScheduleConfig,
  planRoutineFutureRows,
  validateRoutineStepTransition,
  type RoutineScheduleConfig,
  type RoutineFutureSnapshot,
} from "../routine-schedule";
const weekly = {
  frequency: "weekly" as const,
  starts_on: null,
  weekly_days: [5, 1, 3],
  monthly_day: null,
};
const step = {
  template_id: "root-a",
  title: "Fixture breakfast",
  description: null,
  subject: {
    kind: "account" as const,
    user_id: "fixture-parent",
    member_id: null,
  },
  points: 0,
  difficulty: "easy" as const,
  icon: null,
  duration_minutes: 10,
};
const saved: RoutineScheduleConfig = {
  protocol: "herewoven.routine-schedule.v1" as const,
  state: "active",
  effective_on: "2026-10-21",
  anchor: "After breakfast",
  schedule: { ...weekly, starts_on: "2026-10-19" },
  steps: [{ template_id: step.template_id }],
};
const base = {
  protocol: "herewoven.routine-schedule.v1" as const,
  expected_user_id: "fixture-parent",
  expected_family_id: "fixture-family",
  issued_at: "2026-10-20T23:59:00.000Z",
  view_day: "2026-10-20",
  view_zone: "America/Toronto",
};
it("uses explicit viewer day and chosen weekdays, including the selected start, without guessing UTC today", () => {
  expect(
    normalizeRoutineSharedSchedule(weekly, "2026-10-19").weekly_days,
  ).toEqual([1, 3, 5]);
  expect(firstRoutineOccurrence(weekly, "2026-10-19")).toBe("2026-10-19");
  expect(firstRoutineOccurrence(weekly, "2026-10-20")).toBe("2026-10-21");
  expect(
    firstRoutineOccurrence(
      { ...weekly, starts_on: "2026-10-25" },
      "2026-10-20",
    ),
  ).toBe("2026-10-26");
  expect(nextRoutineOccurrence(weekly, "2026-10-23")).toBe("2026-10-26");
});
it("keeps monthly anchor through short months and skips only days before the selected start", () => {
  const monthly = {
    frequency: "monthly" as const,
    starts_on: "2026-01-31",
    weekly_days: [],
    monthly_day: 31,
  };
  expect(firstRoutineOccurrence(monthly, "2026-01-01")).toBe("2026-01-31");
  expect(nextRoutineOccurrence(monthly, "2026-01-31")).toBe("2026-02-28");
  expect(nextRoutineOccurrence(monthly, "2026-02-28")).toBe("2026-03-31");
  expect(nextRoutineOccurrence(monthly, "2028-01-31")).toBe("2028-02-29");
  expect(
    firstRoutineOccurrence(
      { ...monthly, starts_on: "2026-02-15", monthly_day: 10 },
      "2026-01-01",
    ),
  ).toBe("2026-03-10");
});
it("resume starts strictly after the reviewed day without catch-up; stopped cannot resume", () => {
  expect(routineResumeDay({ ...saved, state: "paused" }, "2026-11-01")).toBe(
    "2026-11-02",
  );
  expect(() =>
    routineResumeDay({ ...saved, state: "stopped" }, "2026-11-01"),
  ).toThrow(/stopped/);
  const once = {
    ...saved,
    state: "paused" as const,
    schedule: {
      frequency: "once" as const,
      starts_on: "2026-10-19",
      weekly_days: [],
      monthly_day: null,
    },
  };
  expect(routineResumeDay(once, "2026-11-01")).toBeNull();
  expect(nextRoutineOccurrence(once.schedule, "2026-10-19")).toBeNull();
});
it("refuses meaningless schedules, duplicate step identity and arbitrary account/profile mixing", () => {
  expect(
    routineScheduleConfig.safeParse({
      ...saved,
      schedule: { ...weekly, starts_on: null },
    }).success,
  ).toBe(false);
  expect(
    routineScheduleConfig.safeParse({
      ...saved,
      steps: [
        { template_id: step.template_id },
        { template_id: step.template_id },
      ],
    }).success,
  ).toBe(false);
  const create = {
    ...base,
    action: "create",
    label: "Fixture morning",
    anchor: null,
    schedule: weekly,
    steps: [{ ...step, client_step_id: "new-a", template_id: null }],
  };
  expect(routineScheduleCommand.safeParse(create).success).toBe(true);
  expect(
    routineScheduleCommand.safeParse({
      ...create,
      schedule: { ...weekly, weekly_days: [] },
    }).success,
  ).toBe(false);
  expect(
    routineScheduleCommand.safeParse({
      ...create,
      steps: [
        {
          ...create.steps[0],
          subject: {
            kind: "profile",
            member_id: "profile-a",
            user_id: "fixture-parent",
          },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    routineScheduleCommand.safeParse({
      ...create,
      steps: [{ ...create.steps[0], template_id: "root-a" }],
    }).success,
  ).toBe(false);
  expect(
    routineScheduleCommand.safeParse({
      ...base,
      action: "pause",
      stack_id: "stack-a",
      expected_version: 1,
      scope: "all-history",
    }).success,
  ).toBe(false);
});
const row: RoutineFutureSnapshot = {
  id: "copy-a",
  family_id: "fixture-family",
  routine_stack_id: "stack-a",
  recurrence_id: "root-a",
  is_template: false,
  due_day: "2026-10-21",
  status: "pending",
  photo_url: null,
  photo_verified: false,
  verified_at: null,
  verified_notes: null,
  completed_at: null,
  successor_id: null,
  member_subject_erased: false,
};
it("only plans untouched future copies; roots, today and any work/history are retained", () => {
  const rows = [
    row,
    { ...row, id: "root-a", is_template: true },
    { ...row, id: "today", due_day: "2026-10-20" },
    { ...row, id: "started", status: "in-progress" },
    { ...row, id: "photo", photo_url: "/private-fixture" },
    { ...row, id: "done", completed_at: base.issued_at },
    { ...row, id: "notes", verified_notes: "fixture history" },
    { ...row, id: "erased", member_subject_erased: true },
  ];
  expect(
    planRoutineFutureRows({
      familyId: "fixture-family",
      stackId: "stack-a",
      templateIds: ["root-a"],
      viewDay: "2026-10-20",
      rows,
    }),
  ).toEqual({
    pruneIds: ["copy-a"],
    preserveIds: [
      "root-a",
      "today",
      "started",
      "photo",
      "done",
      "notes",
      "erased",
    ],
  });
  for (const changed of [
    { ...row, family_id: "other-family" },
    { ...row, recurrence_id: "other-root" },
    { ...row, routine_stack_id: "other-stack" },
  ])
    expect(() =>
      planRoutineFutureRows({
        familyId: "fixture-family",
        stackId: "stack-a",
        templateIds: ["root-a"],
        viewDay: "2026-10-20",
        rows: [changed],
      }),
    ).toThrow(/identity/);
});
it("requires every omitted root to have an explicit stop or unstack decision", () => {
  const replace = {
    ...base,
    action: "replace-future" as const,
    stack_id: "stack-a",
    expected_version: 1,
    label: "Fixture morning",
    anchor: null,
    schedule: weekly,
    steps: [{ ...step, client_step_id: "new-a", template_id: null }],
    removed_steps: [],
  };
  expect(() => validateRoutineStepTransition(saved, replace)).toThrow(
    /Every original step/,
  );
  expect(
    validateRoutineStepTransition(saved, {
      ...replace,
      removed_steps: [{ template_id: "root-a", disposition: "unstack-future" }],
    }).removed_steps,
  ).toHaveLength(1);
  expect(() =>
    validateRoutineStepTransition(saved, {
      ...replace,
      removed_steps: [
        { template_id: "foreign-root", disposition: "stop-future" },
      ],
    }),
  ).toThrow(/Every original step/);
});

// Authored only; execution deferred by the user.
it("chooses frequency defaults from the reviewed start instead of the current instant", () => {
  const anchor = routineScheduleAnchorDay("2026-11-02", "America/Toronto", new Date("2026-10-24T12:00:00Z"));
  expect(anchor.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  expect(anchor.getUTCDay()).toBe(1);
  expect(anchor.getUTCDate()).toBe(2);
});
it.each([null, "", "2026-02-30", "invalid"])("uses the viewer day for invalid or absent editable start %s", (startsOn) => {
  expect(routineScheduleAnchorDay(startsOn, "America/Toronto", new Date("2026-10-25T02:00:00Z")).toISOString()).toBe("2026-10-24T00:00:00.000Z");
});
