/** Authored only; consolidated storage/network QA is deferred. */
import { createRoutineRecoveryStore } from "../routine-schedule-recovery-store";
import {
  makeRoutineScheduleIntent,
  postRoutineSchedule,
} from "../routine-schedule-client";
import {
  ROUTINE_RECOVERY_CONTRACT,
  routineRecoveryEntry,
  routineRecoveryReview,
} from "../routine-schedule-recovery-contract";
import type { QueueOwner } from "../queue-owner-contract";
import type { QueueStore } from "../offline-queue";
const owner: QueueOwner = {
  kind: "person",
  ownerId: "fixture-parent",
  scope: "a".repeat(64),
  householdScope: "b".repeat(64),
  generation: 0,
};
const context = {
  contract: ROUTINE_RECOVERY_CONTRACT,
  enabled: true,
  owner,
  userId: owner.ownerId,
  familyId: "fixture-family",
};
const entry = () =>
  makeRoutineScheduleIntent(
    {
      action: "create",
      label: "Fixture morning",
      anchor: null,
      schedule: {
        frequency: "weekly",
        starts_on: null,
        weekly_days: [1, 3],
        monthly_day: null,
      },
      steps: [
        {
          client_step_id: "step-a",
          template_id: null,
          title: "Fixture breakfast",
          description: null,
          subject: { kind: "profile", member_id: "fixture-profile" },
          points: 0,
          difficulty: "easy",
          icon: null,
          duration_minutes: 5,
        },
      ],
    },
    context,
    "America/Toronto",
    new Date("2026-10-20T18:00:00.000Z"),
    "original_fixture_key_001",
  );
function fixture() {
  let value: string | null = null,
    current = context;
  const store: QueueStore = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
  const review = jest.fn(async () => true);
  const build = () =>
    createRoutineRecoveryStore({
      runtime: "fixture_runtime_001",
      resolveContext: async () => current,
      candidates: () => [store],
      withLease: async (_owner, run) => run(),
      reviewRecovered: review,
    });
  return {
    build,
    review,
    changeOwner: () => {
      current = { ...context, owner: { ...owner, scope: "c".repeat(64) } };
    },
    pause: () => {
      current = { ...context, enabled: false };
    },
    value: () => value,
  };
}
it("keeps the original body/key through reload, requires recovered review and retains unknown results", async () => {
  const f = fixture(),
    first = f.build(),
    original = entry();
  await first.initialize();
  await first.stage(original);
  const saved = f.value();
  const reloaded = f.build();
  expect(await reloaded.initialize()).toEqual([
    { ...original, reviewRequired: true },
  ]);
  const send = jest.fn(async () => ({ kind: "unknown" }));
  await expect(reloaded.send(original.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  expect(send).not.toHaveBeenCalled();
  expect(await reloaded.send(original.key, true, send)).toEqual({
    kind: "unknown",
  });
  expect(send).toHaveBeenCalledWith(original, owner.scope);
  expect(f.value()).toBe(saved);
  expect(f.review).toHaveBeenCalledTimes(1);
});
it("holds changed intent/owner and suppresses a late reply after an owner switch", async () => {
  const f = fixture(),
    journal = f.build(),
    original = entry();
  await journal.initialize();
  await journal.stage(original);
  const command = JSON.parse(original.body);
  await expect(
    journal.stage({
      ...original,
      body: JSON.stringify({ ...command, label: "Changed" }),
    }),
  ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
  await expect(
    journal.send(original.key, false, async () => {
      f.changeOwner();
      return { kind: "confirmed" };
    }),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  expect(f.value()).toContain(original.key);
});
it("permits read-only inspection and explicit dismissal while fresh writing is paused", async () => {
  const f = fixture(),
    journal = f.build(),
    original = entry();
  await journal.initialize();
  await journal.stage(original);
  f.pause();
  expect(await journal.inspect(original.key, async (row) => row.body)).toBe(
    original.body,
  );
  await expect(
    journal.send(original.key, false, async () => null),
  ).rejects.toMatchObject({ reason: "DISABLED" });
  await journal.dismiss(original.key);
  expect(f.value()).not.toContain(original.key);
});
it("rejects malformed/oversized bodies and contradictory confirmation without normalizing saved bytes", () => {
  const original = entry();
  expect(
    routineRecoveryEntry.parse({ ...original, body: `  ${original.body}\n` })
      .body,
  ).toBe(`  ${original.body}\n`);
  expect(
    routineRecoveryEntry.safeParse({
      ...original,
      body: "x".repeat(256 * 1024 + 1),
    }).success,
  ).toBe(false);
  expect(
    routineRecoveryReview.safeParse({
      contract: ROUTINE_RECOVERY_CONTRACT,
      ownerScope: owner.scope,
      entry: original,
      state: "committed",
      canRetry: true,
      currentVersion: null,
      receipt: null,
    }).success,
  ).toBe(false);
});
it("sends exact original bytes and treats malformed success as unknown", async () => {
  const previous = global.fetch,
    original = entry();
  const fetcher = jest.fn(
    async (..._args: Parameters<typeof fetch>) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
      }) as Response,
  );
  global.fetch = fetcher;
  try {
    expect(await postRoutineSchedule(original, owner.scope)).toEqual({
      kind: "unknown",
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      body: original.body,
      headers: expect.objectContaining({ "Idempotency-Key": original.key }),
    });
  } finally {
    global.fetch = previous;
  }
});
