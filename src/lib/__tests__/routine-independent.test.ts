/** Authored only; consolidated QA remains deferred. */
import {
  routineStepSeriesConfig,
  planRoutineFutureRows,
} from "../routine-schedule";
import {
  routineIndependentCommand,
  routineIndependentReceipt,
  ROUTINE_INDEPENDENT_PROTOCOL,
} from "../routine-independent";
import {
  assertIndependentIntent,
  routineIndependentFailure,
} from "../routine-independent-runtime";
const now = new Date("2026-10-20T16:00:00.000Z");
const input = routineIndependentCommand.parse({
  protocol: ROUTINE_INDEPENDENT_PROTOCOL,
  expected_user_id: "parent",
  expected_family_id: "family",
  issued_at: now.toISOString(),
  view_day: "2026-10-20",
  view_zone: "America/Toronto",
  root_id: "root",
  expected_revision: 1,
  action: "pause",
  scope: "future-after-today",
});
const definition = routineStepSeriesConfig.parse({
  protocol: "herewoven.routine-step-series.v1",
  stack_id: null,
  state: "active",
  effective_on: "2026-10-20",
  anchor: null,
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-20",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  content: {
    title: "Fixture step",
    description: null,
    points: 0,
    subject: { kind: "profile", member_id: "profile" },
    difficulty: "easy",
    icon: null,
    duration_minutes: null,
  },
});
function refusal(run: () => void) {
  try {
    run();
    throw new Error("Expected refusal");
  } catch (caught) {
    return routineIndependentFailure(caught);
  }
}
it("defaults old staged definitions to revision one and rejects ambiguous commands", () => {
  expect(definition.revision).toBe(1);
  expect(() => assertIndependentIntent(input, definition, now)).not.toThrow();
  expect(
    routineIndependentCommand.safeParse({ ...input, stack_id: "stack" })
      .success,
  ).toBe(false);
  expect(
    routineIndependentCommand.safeParse({ ...input, expected_revision: 0 })
      .success,
  ).toBe(false);
  expect(
    routineIndependentCommand.safeParse({ ...input, scope: "all" }).success,
  ).toBe(false);
  expect(
    routineIndependentCommand.safeParse({ ...input, action: "create" }).success,
  ).toBe(false);
});
it("holds stale revisions, attached roots, stopped definitions and wrong state transitions", () => {
  expect(
    refusal(() =>
      assertIndependentIntent(input, { ...definition, revision: 2 }, now),
    ),
  ).toMatchObject({
    status: 409,
    body: { error: { code: "ROUTINE_VERSION_CONFLICT" } },
  });
  expect(
    refusal(() =>
      assertIndependentIntent(input, { ...definition, stack_id: "stack" }, now),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_STEP_ATTACHED" } } });
  expect(
    refusal(() =>
      assertIndependentIntent(input, { ...definition, state: "stopped" }, now),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_STOPPED" } } });
  expect(
    refusal(() =>
      assertIndependentIntent({ ...input, action: "resume" }, definition, now),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_STATE_CONFLICT" } } });
});
it("does not rebase expired or cross-midnight intent and does not catch up passed once work", () => {
  expect(
    refusal(() =>
      assertIndependentIntent(
        input,
        definition,
        new Date(now.getTime() + 16 * 60000),
      ),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_INTENT_EXPIRED" } } });
  const midnight = { ...input, issued_at: "2026-10-21T03:59:00.000Z" };
  expect(
    refusal(() =>
      assertIndependentIntent(
        midnight,
        definition,
        new Date("2026-10-21T04:01:00.000Z"),
      ),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_INTENT_EXPIRED" } } });
  expect(
    refusal(() =>
      assertIndependentIntent(
        { ...input, action: "resume" },
        {
          ...definition,
          state: "paused",
          schedule: {
            frequency: "once",
            starts_on: "2026-10-20",
            weekly_days: [],
            monthly_day: null,
          },
        },
        now,
      ),
    ),
  ).toMatchObject({ body: { error: { code: "ROUTINE_ONCE_ALREADY_PASSED" } } });
});
it("partitions only exact detached untouched future copies", () => {
  const row = {
    id: "copy",
    family_id: "family",
    routine_stack_id: null,
    recurrence_id: "root",
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
  const partition = (rows: (typeof row)[]) =>
    planRoutineFutureRows({
      familyId: "family",
      stackId: null,
      templateIds: ["root"],
      viewDay: "2026-10-20",
      rows,
    });
  expect(partition([row])).toEqual({ pruneIds: ["copy"], preserveIds: [] });
  expect(
    partition([
      { ...row, id: "root" },
      { ...row, id: "today", due_day: "2026-10-20" },
      { ...row, id: "started", status: "in_progress" },
    ]),
  ).toEqual({ pruneIds: [], preserveIds: ["root", "today", "started"] });
  expect(() => partition([{ ...row, family_id: "other" }])).toThrow();
  expect(() =>
    planRoutineFutureRows({
      familyId: "family",
      stackId: null,
      templateIds: ["root"],
      viewDay: "2026-10-20",
      rows: [{ ...row, routine_stack_id: "old-stack" }],
    }),
  ).toThrow();
});
it("keeps receipts strict and bounded", () => {
  expect(
    routineIndependentReceipt.safeParse({
      protocol: ROUTINE_INDEPENDENT_PROTOCOL,
      requestId: "receipt",
      rootId: "root",
      revision: 2,
      action: "pause",
      state: "paused",
      prunedCount: 0,
      stackId: "unexpected",
    }).success,
  ).toBe(false);
});
