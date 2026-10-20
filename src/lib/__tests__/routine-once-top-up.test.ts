/** Authored only; no database/lifecycle acceptance has been run. */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  topUpScheduledOnceSteps,
  MAX_ONCE_ROUTINES_PER_TOP_UP,
} from "../routine-once-top-up";
import {
  ROUTINE_SCHEDULE_READY_ENV,
  ROUTINE_SCHEDULE_WRITE_ENV,
} from "../routine-schedule-gates";
import { routineStepSeriesConfig } from "../routine-schedule";
jest.mock("../logger", () => ({
  log: { warn: jest.fn() },
  describeError: () => ({ code: "fixture" }),
}));
const now = new Date("2026-10-20T16:00:00Z");
const definition = () =>
  routineStepSeriesConfig.parse({
    protocol: "herewoven.routine-step-series.v1",
    revision: 3,
    once_pending: true,
    anchor_retired: true,
    stack_id: null,
    state: "active",
    effective_on: "2026-10-21",
    anchor: null,
    schedule: {
      frequency: "once",
      starts_on: "2026-10-21",
      weekly_days: [],
      monthly_day: null,
    },
    content: {
      title: "Future once work",
      description: null,
      subject: { kind: "account", user_id: "parent", member_id: null },
      points: 0,
      difficulty: "easy",
      icon: null,
      duration_minutes: null,
    },
  });
function fixture(rows: { id: string; routine_series_config: unknown }[] = []) {
  const raw = jest.fn(
    async (strings: TemplateStringsArray, ..._values: unknown[]) =>
      strings.join("").includes('FROM "Chore" c') ? rows : [],
  );
  const family = jest.fn().mockResolvedValue({ features: { chores: true } });
  const tx = {
    $queryRaw: raw,
    family: { findUnique: family },
  } as unknown as Prisma.TransactionClient;
  const transaction = jest.fn(
    async (run: (tx: Prisma.TransactionClient) => Promise<number>) => run(tx),
  );
  return {
    db: { $transaction: transaction } as unknown as Pick<
      PrismaClient,
      "$transaction"
    >,
    tx,
    raw,
    family,
    transaction,
  };
}
const prior = [ROUTINE_SCHEDULE_READY_ENV, ROUTINE_SCHEDULE_WRITE_ENV].map(
  (key) => [key, process.env[key]] as const,
);
beforeEach(() => {
  process.env[ROUTINE_SCHEDULE_READY_ENV] = "1";
  process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
});
afterAll(() => {
  for (const [key, value] of prior) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
it("is inert while writes pause or household chores are unavailable", async () => {
  const f = fixture(),
    expand = jest.fn(async () => 1);
  process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "0";
  expect(await topUpScheduledOnceSteps(f.db, "family", now, expand)).toBe(0);
  expect(f.transaction).not.toHaveBeenCalled();
  process.env[ROUTINE_SCHEDULE_WRITE_ENV] = "1";
  f.family.mockResolvedValue({ features: { chores: false } });
  expect(await topUpScheduledOnceSteps(f.db, "family", now, expand)).toBe(0);
  expect(expand).not.toHaveBeenCalled();
});
it("selects exact explicit handover checkpoints under a bounded household query", async () => {
  const valid = definition();
  const f = fixture([
    { id: "pending", routine_series_config: valid },
    {
      id: "ordinary-deleted-once",
      routine_series_config: { ...valid, once_pending: false },
    },
    { id: "unknown", routine_series_config: { ...valid, protocol: "future" } },
    { id: "paused", routine_series_config: { ...valid, state: "paused" } },
    {
      id: "erased",
      routine_series_config: {
        ...valid,
        content: { ...valid.content, subject: { kind: "erased" } },
      },
    },
  ]);
  const expand = jest.fn(async () => 1);
  expect(await topUpScheduledOnceSteps(f.db, "family", now, expand)).toBe(1);
  expect(expand).toHaveBeenCalledTimes(1);
  expect(expand).toHaveBeenCalledWith(f.tx, "pending", "family", now);
  const call = f.raw.mock.calls.find(([strings]) =>
    strings.join("").includes('FROM "Chore" c'),
  )!;
  expect(call.slice(1)).toEqual([
    "family",
    expect.any(Boolean),
    MAX_ONCE_ROUTINES_PER_TOP_UP,
  ]);
  expect(call[0].join("?")).toContain("->>'once_pending' = 'true'");
  expect(call[0].join("?")).toContain('c."recurrence_id" = c."id"');
});
it("delegates passed/occupied checkpoint settlement to canonical expansion and contains failure", async () => {
  const f = fixture([
    {
      id: "passed",
      routine_series_config: {
        ...definition(),
        schedule: { ...definition().schedule, starts_on: "2026-10-18" },
        effective_on: "2026-10-18",
      },
    },
  ]);
  const expand = jest.fn(async () => 0);
  expect(await topUpScheduledOnceSteps(f.db, "family", now, expand)).toBe(0);
  expect(expand).toHaveBeenCalledWith(f.tx, "passed", "family", now);
  f.transaction.mockRejectedValueOnce(new Error("fixture-only failure"));
  expect(await topUpScheduledOnceSteps(f.db, "family", now, expand)).toBe(0);
});
