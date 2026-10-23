/** Authored for consolidated QA; no DB, browser or household mutations. */
import type { Prisma } from "@prisma/client";
import {
  routineOccurrencePolicy,
  routineOccurrencePolicyInTx,
  hiddenRoutineOccurrenceIds,
  scheduledOnceRoutineOccurrenceIds,
  type RoutineOccurrenceSnapshot,
} from "../routine-occurrence-policy";
const definition = {
  protocol: "herewoven.routine-step-series.v1",
  stack_id: "fixture-stack",
  state: "paused",
  effective_on: "2026-10-21",
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
    difficulty: "easy",
    icon: null,
    duration_minutes: null,
    subject: { kind: "profile", member_id: "fixture-profile" },
  },
};
const root = (): RoutineOccurrenceSnapshot => ({
  id: "fixture-root",
  recurrence_id: "fixture-root",
  root_id: "fixture-root",
  root_recurrence_id: "fixture-root",
  own_config: definition,
  series_config: definition,
  due_date: new Date("2026-10-21T00:00:00.000Z"),
  status: "pending",
  photo_url: null,
  photo_verified: false,
  verified_at: null,
  verified_notes: null,
  completed_at: null,
  successor_id: null,
  member_subject_erased: false,
});
describe("routine occurrence read/action policy source", () => {
  it("holds inactive future roots and untouched copies, while preserving earlier days and active schedules", () => {
    expect(routineOccurrencePolicy(root())).toBe("inactive");
    expect(
      routineOccurrencePolicy({ ...root(), id: "copy", own_config: null }),
    ).toBe("inactive");
    expect(
      routineOccurrencePolicy({
        ...root(),
        due_date: new Date("2026-10-20T00:00:00Z"),
      }),
    ).toBe("scheduled");
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: { ...definition, state: "active" },
      }),
    ).toBe("scheduled");
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: { ...definition, state: "stopped" },
      }),
    ).toBe("inactive");
  });
  it("retains started work and every evidence/history field, even an explicitly empty note", () => {
    for (const evidence of [
      { status: "in_progress" },
      { status: "completed" },
      { status: "verified" },
      { photo_url: "private-fixture-photo" },
      { photo_url: "" },
      { photo_verified: true },
      { verified_notes: "" },
      { verified_at: new Date() },
      { completed_at: new Date() },
      { successor_id: "next" },
      { member_subject_erased: true },
    ])
      expect(routineOccurrencePolicy({ ...root(), ...evidence })).toBe(
        "scheduled",
      );
  });
  it("holds unknown or contradictory metadata and keeps ordinary legacy rows unchanged", () => {
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: { protocol: "future" },
      }),
    ).toBe("unsupported");
    expect(routineOccurrencePolicy({ ...root(), root_id: null })).toBe(
      "unsupported",
    );
    expect(
      routineOccurrencePolicy({ ...root(), root_recurrence_id: "different" }),
    ).toBe("unsupported");
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: null,
        series_config: null,
      }),
    ).toBe("legacy");
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: {
          ...definition,
          state: "active",
          schedule: {
            frequency: "once",
            starts_on: "2026-10-21",
            weekly_days: [],
            monthly_day: null,
          },
        },
      }),
    ).toBe("scheduled-once");
  });
  it("keeps a retired pristine anchor hidden after resume without hiding its real copies or evidence", () => {
    const resumed = {
      ...definition,
      state: "active",
      effective_on: "2026-10-25",
      anchor_retired: true,
    };
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: resumed,
        series_config: resumed,
      }),
    ).toBe("inactive");
    expect(
      routineOccurrencePolicy({
        ...root(),
        id: "copy",
        own_config: null,
        series_config: resumed,
      }),
    ).toBe("scheduled");
    expect(
      routineOccurrencePolicy({
        ...root(),
        own_config: resumed,
        photo_url: "fixture-proof",
      }),
    ).toBe("scheduled");
  });
  it("projects one-time capability only from owned selected canonical definitions", async () => {
    const once = {
      ...definition,
      state: "active",
      schedule: {
        frequency: "once",
        starts_on: "2026-10-21",
        weekly_days: [],
        monthly_day: null,
      },
    };
    const raw = jest.fn(
      async (..._args: unknown[]): Promise<RoutineOccurrenceSnapshot[]> => [
        { ...root(), own_config: once, series_config: once },
        {
          ...root(),
          id: "not-requested",
          own_config: null,
          series_config: once,
        },
        {
          ...root(),
          id: "completed-copy",
          own_config: null,
          series_config: once,
          status: "completed",
        },
        {
          ...root(),
          id: "paused-copy",
          own_config: null,
          series_config: { ...once, state: "paused" },
        },
        {
          ...root(),
          id: "unknown-copy",
          own_config: null,
          series_config: { protocol: "future" },
        },
        {
          ...root(),
          id: "weekly-copy",
          own_config: null,
          series_config: { ...definition, state: "active" },
        },
      ],
    );
    const db = { $queryRaw: raw } as unknown as Prisma.TransactionClient;
    expect(await scheduledOnceRoutineOccurrenceIds(db, "family-a", [])).toEqual(
      new Set(),
    );
    expect(raw).not.toHaveBeenCalled();
    const ids = [
      "fixture-root",
      "completed-copy",
      "paused-copy",
      "unknown-copy",
      "weekly-copy",
      "fixture-root",
    ];
    expect(
      await scheduledOnceRoutineOccurrenceIds(db, "family-a", ids),
    ).toEqual(new Set(["fixture-root", "completed-copy"]));
    expect(raw.mock.calls[0].slice(1)).toEqual(["family-a", [...new Set(ids)]]);
    const sql = (raw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain('r."family_id" = c."family_id"');
    expect(sql).toContain('c."family_id" = ?');
    expect(sql).toContain('c."id" = ANY(?::text[])');
  });
  it("returns only hidden IDs and binds both read/effect SQL to the supplied household", async () => {
    const raw = jest.fn(
      async (..._args: unknown[]): Promise<RoutineOccurrenceSnapshot[]> => [
        root(),
        {
          ...root(),
          id: "evidence-copy",
          own_config: null,
          photo_url: "fixture-photo",
        },
      ],
    );
    const tx = { $queryRaw: raw } as unknown as Prisma.TransactionClient;
    expect(await hiddenRoutineOccurrenceIds(tx, "family-a")).toEqual([
      "fixture-root",
    ]);
    expect(raw.mock.calls[0].slice(1)).toEqual(["family-a"]);
    raw.mockResolvedValueOnce([root()]);
    expect(
      await routineOccurrencePolicyInTx(tx, "family-a", "fixture-root"),
    ).toBe("inactive");
    expect(raw.mock.calls[1].slice(1)).toEqual(["family-a", "fixture-root"]);
    raw.mockResolvedValueOnce([]);
    expect(await routineOccurrencePolicyInTx(tx, "family-a", "missing")).toBe(
      "unsupported",
    );
  });
});
