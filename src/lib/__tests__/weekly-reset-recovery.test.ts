/** Exact recovery source cases; execution and real PostgreSQL acceptance deferred. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency";
import { WEEKLY_RESET_PROTOCOL } from "@/lib/weekly-reset";
import {
  weeklyResetRecoveryEntry,
  weeklyResetEntryMatchesContext,
  weeklyResetRecoveryReview,
  WEEKLY_RESET_RECOVERY,
} from "@/lib/weekly-reset-recovery";
import { reviewWeeklyResetRequest } from "@/lib/weekly-reset-recovery-server";
const now = new Date("2026-10-20T16:00:00Z");
const actor = { userId: "user-a", familyId: "family-a", tokenVersion: 0 };
const command = {
  protocol: WEEKLY_RESET_PROTOCOL,
  userId: actor.userId,
  familyId: actor.familyId,
  issuedAt: now.toISOString(),
  weekStart: "2026-10-19",
  timeZone: "America/Toronto",
  expectedRevision: 0,
  action: "start" as const,
};
const entry = {
  kind: "weekly-reset" as const,
  key: "weekly_reset_request_a",
  body: JSON.stringify(command),
};
const ownerScope = "a".repeat(64);
const context = {
  contract: WEEKLY_RESET_RECOVERY,
  userId: actor.userId,
  familyId: actor.familyId,
  enabled: false,
  owner: null,
};
function fixture(patch = {}) {
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join("?").includes('FROM "User"')
        ? [
            {
              id: actor.userId,
              family_id: actor.familyId,
              role: "parent",
              token_version: 0,
              progress: null,
              revision: 0,
              ...patch,
            },
          ]
        : [],
    ),
    family: {
      findUnique: jest.fn(async () => ({ features: defaultFeatures() })),
    },
    idempotencyRecord: { findUnique: jest.fn(async () => null as unknown) },
    $executeRaw: jest.fn(),
  };
  return {
    tx,
    db: {
      $transaction: async (run: (tx: unknown) => unknown) => run(tx),
    } as unknown as PrismaClient,
  };
}
it("rejects malformed saved bodies and binds intents to the exact account and family", () => {
  expect(
    weeklyResetRecoveryEntry.safeParse({ ...entry, body: "{" }).success,
  ).toBe(false);
  expect(
    weeklyResetRecoveryEntry.safeParse({
      ...entry,
      body: JSON.stringify({ ...command, userId: undefined }),
    }).success,
  ).toBe(false);
  expect(weeklyResetEntryMatchesContext(entry, context)).toBe(true);
  expect(
    weeklyResetEntryMatchesContext(entry, { ...context, userId: "user-b" }),
  ).toBe(false);
  expect(
    weeklyResetEntryMatchesContext(entry, { ...context, familyId: "family-b" }),
  ).toBe(false);
});
it.each([{ family_id: "family-b" }, { token_version: 1 }, { role: "unknown" }])(
  "renews current authority before receipt inspection %j",
  async (row) => {
    const { db, tx } = fixture(row);
    await expect(
      reviewWeeklyResetRequest(db, actor, entry, ownerScope, true, now),
    ).rejects.toThrow();
    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  },
);
it("reads a committed exact receipt before expiration/revision checks without a second effect", async () => {
  const { db, tx } = fixture({ revision: 5 });
  const proof = {
    receipt: {
      protocol: WEEKLY_RESET_PROTOCOL,
      userId: actor.userId,
      familyId: actor.familyId,
      weekStart: command.weekStart,
      timeZone: command.timeZone,
      action: "start",
      revision: 1,
    },
  };
  tx.idempotencyRecord.findUnique.mockResolvedValue({
    user_id: actor.userId,
    family_id: actor.familyId,
    action: "weekly-reset.progress.v1",
    request_hash: hashIdempotentRequest("weekly-reset.progress.v1", command),
    response_status: 200,
    response_body: proof,
  });
  const value = await reviewWeeklyResetRequest(
    db,
    actor,
    entry,
    ownerScope,
    false,
    new Date(now.getTime() + 86400000),
  );
  expect(value).toMatchObject({
    state: "committed",
    canRetry: false,
    currentRevision: 5,
    receipt: proof,
  });
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it("never offers retry after age, revision, rollout or unknown stored-protocol holds", async () => {
  const { db } = fixture();
  expect(
    (
      await reviewWeeklyResetRequest(
        db,
        actor,
        entry,
        ownerScope,
        true,
        new Date(now.getTime() + 16 * 60000),
      )
    ).state,
  ).toBe("expired");
  expect(
    (await reviewWeeklyResetRequest(db, actor, entry, ownerScope, false, now))
      .state,
  ).toBe("paused");
  expect(
    (
      await reviewWeeklyResetRequest(
        fixture({ revision: 2 }).db,
        actor,
        entry,
        ownerScope,
        true,
        now,
      )
    ).state,
  ).toBe("conflict");
  expect(
    (
      await reviewWeeklyResetRequest(
        fixture({ progress: { protocol: "future" } }).db,
        actor,
        entry,
        ownerScope,
        true,
        now,
      )
    ).state,
  ).toBe("unavailable");
});
it("holds different intent/account use of an existing key instead of revealing its old receipt", async () => {
  const { db, tx } = fixture();
  tx.idempotencyRecord.findUnique.mockResolvedValue({
    user_id: "user-b",
    family_id: actor.familyId,
    action: "weekly-reset.progress.v1",
    request_hash: "different",
    response_status: 200,
    response_body: { private: "not returned" },
  });
  await expect(
    reviewWeeklyResetRequest(db, actor, entry, ownerScope, true, now),
  ).rejects.toThrow("CONFLICT");
});
it("requires matching original actor/scope/action on a claimed committed receipt", () => {
  expect(
    weeklyResetRecoveryReview.safeParse({
      contract: WEEKLY_RESET_RECOVERY,
      ownerScope,
      entry,
      state: "committed",
      canRetry: false,
      currentRevision: 1,
      receipt: {
        receipt: {
          protocol: WEEKLY_RESET_PROTOCOL,
          userId: "user-b",
          familyId: actor.familyId,
          weekStart: command.weekStart,
          timeZone: command.timeZone,
          action: "start",
          revision: 1,
        },
      },
    }).success,
  ).toBe(false);
  expect(
    weeklyResetRecoveryReview.safeParse({
      contract: WEEKLY_RESET_RECOVERY,
      ownerScope,
      entry: { ...entry, body: "{" },
      state: "unavailable",
      canRetry: false,
      currentRevision: 1,
      receipt: null,
    }).success,
  ).toBe(false);
});
