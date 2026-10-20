/** Authored for the later consolidated QA pass; no runtime/provider fixtures. */
import type { Prisma } from "@prisma/client";
import {
  expandRoutineScheduleInTx,
  routineExpansionDays,
} from "../routine-schedule-expansion";
import { routineStepSeriesConfig } from "../routine-schedule";
import {
  ROUTINE_SCHEDULE_READY_ENV,
  ROUTINE_SCHEDULE_WRITE_ENV,
} from "../routine-schedule-gates";
import { eligibleChoreAssigneeInTx } from "../chore-member-subject";
import { eligibleProfileChoreAssigneeInTx } from "../chore-profile-assignee";
jest.mock("../chore-member-subject", () => ({
  eligibleChoreAssigneeInTx: jest.fn(),
}));
jest.mock("../chore-profile-assignee", () => ({
  eligibleProfileChoreAssigneeInTx: jest.fn(),
}));
const account = jest.mocked(eligibleChoreAssigneeInTx);
const profile = jest.mocked(eligibleProfileChoreAssigneeInTx);
const definition = () =>
  routineStepSeriesConfig.parse({
    protocol: "herewoven.routine-step-series.v1",
    stack_id: null,
    state: "active",
    effective_on: "2026-10-21",
    anchor: "After breakfast",
    schedule: {
      frequency: "weekly",
      starts_on: "2026-10-20",
      weekly_days: [1, 3],
      monthly_day: null,
    },
    content: {
      title: "New future title",
      description: null,
      subject: {
        kind: "account",
        user_id: "fixture-parent",
        member_id: "fixture-member",
      },
      points: 5,
      difficulty: "easy",
      icon: null,
      duration_minutes: 10,
    },
  });
const root = {
  id: "fixture-root",
  family_id: "fixture-family",
  recurrence_id: "fixture-root",
  created_by: "fixture-parent",
  member_subject_erased: false,
};
function fixture() {
  const calls = {
    chore: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest
        .fn()
        .mockImplementation(async ({ data }) => ({ count: data.length })),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  return { calls, tx: calls as unknown as Prisma.TransactionClient };
}
describe("scheduled routine canonical expansion source", () => {
  const priorReady = process.env[ROUTINE_SCHEDULE_READY_ENV],
    priorWrite = process.env[ROUTINE_SCHEDULE_WRITE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    process.env[ROUTINE_SCHEDULE_READY_ENV] = "1";
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
    account.mockResolvedValue({
      assigned_to: "fixture-parent",
      assigned_member_id: "fixture-member",
    });
    profile.mockResolvedValue({
      assigned_to: null,
      assigned_member_id: "fixture-profile",
    });
  });
  afterAll(() => {
    if (priorReady === undefined)
      delete process.env[ROUTINE_SCHEDULE_READY_ENV];
    else process.env[ROUTINE_SCHEDULE_READY_ENV] = priorReady;
    if (priorWrite === undefined)
      delete process.env[ROUTINE_SCHEDULE_WRITE_ENV];
    else process.env[ROUTINE_SCHEDULE_WRITE_ENV] = priorWrite;
  });
  it("bounds selected weekdays, skips missed days and preserves monthly anchors", () => {
    expect(routineExpansionDays(definition(), "2026-10-20")).toEqual([
      "2026-10-21",
      "2026-10-26",
      "2026-10-28",
      "2026-11-02",
      "2026-11-04",
      "2026-11-09",
      "2026-11-11",
      "2026-11-16",
    ]);
    const monthly = {
      ...definition(),
      effective_on: "2027-01-31",
      schedule: {
        frequency: "monthly" as const,
        starts_on: "2027-01-31",
        weekly_days: [],
        monthly_day: 31,
      },
    };
    expect(routineExpansionDays(monthly, "2027-02-01")).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
    const once = {
      ...definition(),
      schedule: {
        frequency: "once" as const,
        starts_on: "2026-10-20",
        weekly_days: [],
        monthly_day: null,
      },
    };
    expect(routineExpansionDays(once, "2026-10-20")).toEqual(["2026-10-21"]);
    expect(routineExpansionDays(once, "2026-10-22")).toEqual([]);
  });
  it("uses future content for detached roots, leaves occupied history alone and snapshots new copies only", async () => {
    const { tx, calls } = fixture();
    calls.chore.findMany.mockResolvedValue([
      { due_date: new Date("2026-10-21T00:00:00Z") },
    ]);
    expect(
      await expandRoutineScheduleInTx(tx, root, definition(), "2026-10-20"),
    ).toBe(7);
    const copies = calls.chore.createMany.mock.calls[0][0].data;
    expect(copies[0]).toMatchObject({
      title: "New future title",
      assigned_to: "fixture-parent",
      assigned_member_id: "fixture-member",
      recurrence_id: root.id,
      routine_stack_id: null,
      routine: null,
      routine_order: null,
      frequency: "once",
      is_template: false,
    });
    expect(
      copies.map((row: { due_date: Date }) =>
        row.due_date.toISOString().slice(0, 10),
      ),
    ).not.toContain("2026-10-21");
    expect(calls.$executeRaw).toHaveBeenCalledTimes(1);
    expect(calls.$queryRaw).not.toHaveBeenCalled();
  });
  it("renews exact canonical subject and refuses an account member remap", async () => {
    const { tx, calls } = fixture();
    account.mockResolvedValue({
      assigned_to: "fixture-parent",
      assigned_member_id: "another-member",
    });
    expect(
      await expandRoutineScheduleInTx(tx, root, definition(), "2026-10-20"),
    ).toBe(0);
    expect(calls.chore.createMany).not.toHaveBeenCalled();
  });
  it("uses email-free profile authority without inventing a user assignment", async () => {
    const { tx, calls } = fixture();
    const saved = definition();
    saved.content.subject = { kind: "profile", member_id: "fixture-profile" };
    await expandRoutineScheduleInTx(tx, root, saved, "2026-10-20");
    expect(account).not.toHaveBeenCalled();
    expect(profile).toHaveBeenCalledWith(
      tx,
      root.family_id,
      "fixture-profile",
      true,
    );
    expect(calls.chore.createMany.mock.calls[0][0].data[0]).toMatchObject({
      assigned_to: null,
      assigned_member_id: "fixture-profile",
    });
  });
  it("requires matching owned stack schedule and derives order from authored step IDs", async () => {
    const { tx, calls } = fixture();
    const saved = { ...definition(), stack_id: "fixture-stack" };
    const stack = {
      protocol: "herewoven.routine-schedule.v1",
      state: saved.state,
      effective_on: saved.effective_on,
      anchor: saved.anchor,
      schedule: saved.schedule,
      steps: [{ template_id: "other-root" }, { template_id: root.id }],
    };
    calls.$queryRaw.mockResolvedValue([
      { label: "Morning", schedule_config: stack },
    ]);
    await expandRoutineScheduleInTx(tx, root, saved, "2026-10-20");
    expect(calls.chore.createMany.mock.calls[0][0].data[0]).toMatchObject({
      routine_stack_id: "fixture-stack",
      routine: "Morning",
      routine_order: 2,
    });
    calls.chore.createMany.mockClear();
    calls.$queryRaw.mockResolvedValue([
      { label: "Morning", schedule_config: { ...stack, state: "paused" } },
    ]);
    expect(await expandRoutineScheduleInTx(tx, root, saved, "2026-10-20")).toBe(
      0,
    );
    expect(calls.chore.createMany).not.toHaveBeenCalled();
  });
  it("holds unknown, paused, stopped, erased, non-root and rollout-paused definitions", async () => {
    const { tx, calls } = fixture();
    for (const value of [
      { future_protocol: true },
      { ...definition(), state: "paused" },
      { ...definition(), state: "stopped" },
    ])
      expect(
        await expandRoutineScheduleInTx(tx, root, value, "2026-10-20"),
      ).toBe(0);
    expect(
      await expandRoutineScheduleInTx(
        tx,
        { ...root, member_subject_erased: true },
        definition(),
        "2026-10-20",
      ),
    ).toBe(0);
    expect(
      await expandRoutineScheduleInTx(
        tx,
        { ...root, recurrence_id: "other" },
        definition(),
        "2026-10-20",
      ),
    ).toBe(0);
    process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "0";
    expect(
      await expandRoutineScheduleInTx(tx, root, definition(), "2026-10-20"),
    ).toBe(0);
    expect(calls.chore.createMany).not.toHaveBeenCalled();
  });
});
