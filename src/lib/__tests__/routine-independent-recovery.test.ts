/** Authored only; storage/network QA is deferred. */
import { createIndependentRecoveryStore } from "../routine-independent-store";
import {
  makeIndependentRoutineIntent,
  postIndependentRoutineStep,
} from "../routine-independent-client";
import {
  independentRecoveryEntry,
  independentRecoveryReview,
  INDEPENDENT_RECOVERY_CONTRACT,
} from "../routine-independent-recovery";
import { routineIndependentOwner } from "../routine-schedule-owner";
import type { QueueOwner } from "../queue-owner-contract";
import type { QueueStore } from "../offline-queue";
const base: QueueOwner = {
  kind: "person",
  ownerId: "parent",
  scope: "a".repeat(64),
  householdScope: "b".repeat(64),
  generation: 0,
};
const owner = routineIndependentOwner(base)!;
const context = {
  contract: INDEPENDENT_RECOVERY_CONTRACT,
  enabled: true,
  owner,
  userId: "parent",
  familyId: "family",
};
const entry = () =>
  makeIndependentRoutineIntent(
    {
      action: "pause",
      root_id: "fixture-root",
      expected_revision: 2,
      scope: "future-after-today",
    },
    context,
    "America/Toronto",
    new Date("2026-10-20T16:00:00.000Z"),
    "original_independent_key_001",
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
    createIndependentRecoveryStore({
      runtime: "independent_fixture",
      resolveContext: async () => current,
      candidates: () => [store],
      withLease: async (_owner, run) => run(),
      reviewRecovered: review,
    });
  return {
    build,
    review,
    value: () => value,
    pause: () => {
      current = { ...context, enabled: false };
    },
    changeOwner: () => {
      current = {
        ...context,
        owner: { ...owner, generation: 1, scope: "c".repeat(64) },
      };
    },
  };
}
it("uses a stable separate retirement-compatible namespace", () => {
  expect(owner.scope).not.toBe(base.scope);
  expect(owner).toMatchObject({
    kind: "person",
    ownerId: base.ownerId,
    generation: base.generation,
    householdScope: base.householdScope,
  });
  expect(routineIndependentOwner(base)).toEqual(owner);
  expect(routineIndependentOwner(null)).toBeNull();
});
it("reloads original bytes, requires review and retains unknown results", async () => {
  const f = fixture(),
    original = entry(),
    first = f.build();
  await first.initialize();
  await first.stage(original);
  const saved = f.value(),
    reloaded = f.build();
  expect(await reloaded.initialize()).toEqual([
    { ...original, reviewRequired: true },
  ]);
  const send = jest.fn(async () => ({ kind: "unknown" }));
  await expect(reloaded.send(original.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  expect(send).not.toHaveBeenCalled();
  await reloaded.send(original.key, true, send);
  expect(send).toHaveBeenCalledWith(original, owner.scope);
  expect(f.value()).toBe(saved);
  expect(f.review).toHaveBeenCalledTimes(1);
});
it("holds replaced intent and a reply arriving after owner changes", async () => {
  const f = fixture(),
    journal = f.build(),
    original = entry();
  await journal.initialize();
  await journal.stage(original);
  await expect(
    journal.stage({
      ...original,
      body: JSON.stringify({ ...JSON.parse(original.body), action: "stop" }),
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
it("allows result inspection and explicit dismissal during a write pause", async () => {
  const f = fixture(),
    journal = f.build(),
    original = entry();
  await journal.initialize();
  await journal.stage(original);
  f.pause();
  expect(await journal.inspect(original.key, async (row) => row.body)).toBe(
    original.body,
  );
  const send = jest.fn(async () => ({ kind: "unknown" }));
  await expect(journal.send(original.key, false, send)).rejects.toMatchObject({
    reason: "DISABLED",
  });
  expect(send).not.toHaveBeenCalled();
  await journal.dismiss(original.key);
  expect(f.value()).not.toContain(original.key);
});
it("rejects mismatched proof, contradictory state and oversized original bodies", () => {
  const original = entry();
  expect(
    independentRecoveryEntry.parse({ ...original, body: ` ${original.body}\n` })
      .body,
  ).toBe(` ${original.body}\n`);
  expect(
    independentRecoveryEntry.safeParse({
      ...original,
      body: "x".repeat(256 * 1024 + 1),
    }).success,
  ).toBe(false);
  const review = {
    contract: INDEPENDENT_RECOVERY_CONTRACT,
    ownerScope: owner.scope,
    entry: original,
    state: "committed",
    canRetry: false,
    currentRevision: 3,
    receipt: {
      protocol: "herewoven.routine-independent.v1",
      requestId: "receipt",
      rootId: "fixture-root",
      revision: 3,
      action: "pause",
      state: "paused",
      prunedCount: 1,
    },
  };
  expect(independentRecoveryReview.safeParse(review).success).toBe(true);
  expect(
    independentRecoveryReview.safeParse({ ...review, canRetry: true }).success,
  ).toBe(false);
  expect(
    independentRecoveryReview.safeParse({
      ...review,
      receipt: { ...review.receipt, revision: 4 },
    }).success,
  ).toBe(false);
  expect(
    independentRecoveryReview.safeParse({
      ...review,
      receipt: { ...review.receipt, rootId: "other-root" },
    }).success,
  ).toBe(false);
});
it("posts exact original bytes/key and holds wrong-revision or malformed successes", async () => {
  const previous = global.fetch,
    original = entry();
  let body: unknown = {
    protocol: "herewoven.routine-independent.v1",
    requestId: "receipt",
    rootId: "fixture-root",
    revision: 4,
    action: "pause",
    state: "paused",
    prunedCount: 0,
  };
  const fetcher = jest.fn(
    async (..._args: Parameters<typeof fetch>) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      }) as Response,
  );
  global.fetch = fetcher;
  try {
    expect(await postIndependentRoutineStep(original, owner.scope)).toEqual({
      kind: "unknown",
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      body: original.body,
      headers: expect.objectContaining({ "Idempotency-Key": original.key }),
    });
    body = { ...(body as object), revision: 3 };
    expect(
      await postIndependentRoutineStep(original, owner.scope),
    ).toMatchObject({ kind: "confirmed", receipt: { revision: 3 } });
    body = { success: true };
    expect(await postIndependentRoutineStep(original, owner.scope)).toEqual({
      kind: "unknown",
    });
  } finally {
    global.fetch = previous;
  }
});
