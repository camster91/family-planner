/** Authored only; consolidated mounted/role/device QA remains deferred. */
import {
  routineDraftFromState,
  routineEditorCommand,
  removeRoutineEditorStep,
  restoreRoutineEditorStep,
} from "../routine-schedule-editor";
import { routineScheduleState } from "../routine-schedule-view";
import { makeRoutineScheduleIntent } from "../routine-schedule-client";
jest.mock("../idempotency-key", () => {
  let next = 0;
  return { newIdempotencyKey: () => `fixture_client_step_${++next}` };
});
function state() {
  return routineScheduleState.parse({
    protocol: "herewoven.routine-schedule.v1",
    userId: "fixture-parent",
    familyId: "fixture-family",
    stackId: "fixture-stack",
    version: 3,
    label: "Morning",
    pointsEnabled: false,
    config: {
      protocol: "herewoven.routine-schedule.v1",
      state: "active",
      effective_on: "2026-10-21",
      anchor: "After breakfast",
      schedule: {
        frequency: "weekly",
        starts_on: "2026-10-21",
        weekly_days: [1, 3],
        monthly_day: null,
      },
      steps: [{ template_id: "root-one" }, { template_id: "root-two" }],
    },
    steps: ["root-one", "root-two"].map((template_id) => ({
      template_id,
      title: "Same title",
      description: null,
      subject: { kind: "profile", member_id: "fixture-profile" },
      difficulty: "easy",
      icon: null,
      duration_minutes: 5,
    })),
  });
}
it("keeps equal-named roots distinct, requires removal scope and restores the same root/position", () => {
  const original = routineDraftFromState(state());
  expect(original.steps[0].client_step_id).not.toBe(
    original.steps[1].client_step_id,
  );
  expect(() => removeRoutineEditorStep(original, 0)).toThrow();
  const removed = removeRoutineEditorStep(original, 0, "unstack-future"),
    command = routineEditorCommand(removed);
  expect(command).toMatchObject({
    action: "replace-future",
    expected_version: 3,
    removed_steps: [{ template_id: "root-one", disposition: "unstack-future" }],
  });
  if (command.action !== "replace-future") throw new Error("fixture mismatch");
  expect(Object.keys(command.removed_steps[0]).sort()).toEqual([
    "disposition",
    "template_id",
  ]);
  const restored = restoreRoutineEditorStep(removed, "root-one");
  expect(restored.steps).toEqual(original.steps);
  expect(restored.removed).toEqual([]);
});
it("preserves hidden points as null and freezes the reviewed day/zone instead of minting at send time", () => {
  const draft = routineDraftFromState(state());
  expect(draft.steps.every((step) => step.points === null)).toBe(true);
  const entry = makeRoutineScheduleIntent(
    routineEditorCommand(draft),
    { userId: "fixture-parent", familyId: "fixture-family" },
    "America/Toronto",
    new Date("2026-10-21T03:59:00.000Z"),
    "original_fixture_key_001",
  );
  expect(JSON.parse(entry.body)).toMatchObject({
    view_day: "2026-10-20",
    view_zone: "America/Toronto",
    expected_user_id: "fixture-parent",
    expected_family_id: "fixture-family",
    expected_version: 3,
  });
  expect(
    routineScheduleState.safeParse({
      ...state(),
      steps: state().steps.map((step) => ({ ...step, points: 20 })),
    }).success,
  ).toBe(false);
});
