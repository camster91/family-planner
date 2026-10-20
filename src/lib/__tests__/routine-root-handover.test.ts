/** Authored source only; deletion/rollback QA is deferred. */
import {
  replaceRoutineControlRoots,
  handOverRoutineControlRootsInTx,
} from "../routine-root-handover";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "../routine-occurrence-policy";
import { routineStepSeriesConfig } from "../routine-schedule";
import type { Prisma } from "@prisma/client";
const config = {
  protocol: "herewoven.routine-schedule.v1",
  state: "active",
  effective_on: "2026-10-21",
  anchor: "After lunch",
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-21",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  steps: [{ template_id: "root-a" }, { template_id: "root-b" }],
};
it("replaces exact root slots in author order without mutating accepted or unsupported data", () => {
  const before = JSON.stringify(config),
    replacements = new Map([["root-a", "replacement-a"]]);
  expect(replaceRoutineControlRoots(config, replacements)).toEqual({
    ...config,
    steps: [{ template_id: "replacement-a" }, { template_id: "root-b" }],
  });
  expect(JSON.stringify(config)).toBe(before);
  expect(
    replaceRoutineControlRoots(config, new Map([["Morning", "wrong"]])),
  ).toBeNull();
  const unknown = {
    ...config,
    protocol: "future.protocol",
    private_extension: { retained: true },
  };
  expect(replaceRoutineControlRoots(unknown, replacements)).toEqual({
    ...unknown,
    steps: [{ template_id: "replacement-a" }, { template_id: "root-b" }],
  });
  expect(() =>
    replaceRoutineControlRoots(
      config,
      new Map([
        ["root-a", "duplicate"],
        ["root-b", "duplicate"],
      ]),
    ),
  ).toThrow();
});
it("hides anonymous retired control anchors but preserves evidence-bearing history", () => {
  const definition = routineStepSeriesConfig.parse({
    protocol: "herewoven.routine-step-series.v1",
    revision: 3,
    stack_id: "stack",
    state: "active",
    anchor_retired: true,
    effective_on: "2026-10-21",
    anchor: null,
    schedule: config.schedule,
    content: {
      title: "Future work",
      description: null,
      subject: { kind: "account", user_id: "survivor", member_id: null },
      points: 7,
      difficulty: "easy",
      icon: null,
      duration_minutes: null,
    },
  });
  const row: RoutineOccurrenceSnapshot = {
    id: "replacement",
    root_id: "replacement",
    recurrence_id: "replacement",
    root_recurrence_id: "replacement",
    own_config: definition,
    series_config: definition,
    due_date: new Date("2026-10-19T00:00:00Z"),
    status: "pending",
    photo_url: null,
    photo_verified: false,
    verified_at: null,
    verified_notes: null,
    completed_at: null,
    successor_id: null,
    member_subject_erased: true,
  };
  expect(routineOccurrencePolicy(row)).toBe("inactive");
  expect(
    routineOccurrencePolicy({ ...row, photo_url: "fixture-evidence.jpg" }),
  ).toBe("scheduled");
});
it("does no handover work before the additive root storage exists", async () => {
  const raw = jest.fn().mockResolvedValue([{ present: false }]),
    create = jest.fn();
  const tx = {
    $queryRaw: raw,
    chore: { create },
  } as unknown as Prisma.TransactionClient;
  expect(
    await handOverRoutineControlRootsInTx(
      tx,
      "family",
      "departing",
      "successor",
    ),
  ).toEqual(new Map());
  expect(create).not.toHaveBeenCalled();
});
