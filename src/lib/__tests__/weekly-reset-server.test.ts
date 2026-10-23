/** Transactional source cases; fake statements do not prove PostgreSQL atomicity. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import {
  readWeeklyReset,
  readWeeklyResetSummary,
  writeWeeklyReset,
} from "../weekly-reset-server";
import { WEEKLY_RESET_PROTOCOL } from "../weekly-reset";
const actor = { userId: "user-a", familyId: "family-a", tokenVersion: 0 };
const scope = { weekStart: "2026-10-19", timeZone: "America/Toronto" };
const command = {
  ...scope,
  protocol: WEEKLY_RESET_PROTOCOL,
  familyId: actor.familyId,
  userId: actor.userId,
  issuedAt: new Date().toISOString(),
  expectedRevision: 0,
  action: "start" as const,
};
function fixture(overrides = {}) {
  const row = {
    id: "user-a",
    family_id: "family-a",
    role: "parent",
    token_version: 0,
    progress: null,
    revision: 0,
    ...overrides,
  };
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join("?").includes('FROM "User"') ? [row] : [],
    ),
    $executeRaw: jest.fn(async () => 1),
    family: {
      findUnique: jest.fn(async () => ({ features: defaultFeatures() })),
    },
    idempotencyRecord: {
      findFirst: jest.fn(async () => ({
        response_status: null as number | null,
        response_body: null as unknown,
      })),
      update: jest.fn(),
    },
    event: { findMany: jest.fn(async () => []) },
  };
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  return { db, tx };
}
it.each([{ token_version: 1 }, { family_id: "family-b" }, { role: "unknown" }])(
  "refuses stale/cross-household authority before summary reads: %j",
  async (row) => {
    const { db, tx } = fixture(row);
    await expect(
      readWeeklyResetSummary(db, actor, scope, "schedule"),
    ).rejects.toThrow();
    expect(tx.event.findMany).not.toHaveBeenCalled();
  },
);
it("returns only the current actor's scoped summary after renewing authority", async () => {
  const { db, tx } = fixture();
  const result = await readWeeklyResetSummary(db, actor, scope, "schedule");
  expect(result.owner).toEqual({
    userId: actor.userId,
    familyId: actor.familyId,
  });
  expect(result.scope).toEqual(scope);
  expect(tx.event.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ family_id: actor.familyId }),
    }),
  );
});
it.each([{ token_version: 1 }, { family_id: "family-b" }, { role: "unknown" }])(
  "refuses changed authority before progress or receipt writes: %j",
  async (row) => {
    const { db, tx } = fixture(row);
    await expect(
      writeWeeklyReset(db, actor, command, "receipt-a"),
    ).rejects.toThrow();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  },
);
it("checks revision and unknown protocol before mutation, without replacing future metadata", async () => {
  for (const overrides of [
    { revision: 1 },
    { progress: { protocol: "future" } },
  ]) {
    const { db, tx } = fixture(overrides);
    await expect(
      writeWeeklyReset(db, actor, command, "receipt-a"),
    ).rejects.toThrow();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  }
});
it("writes only own User review metadata and the atomic minimal receipt", async () => {
  const { db, tx } = fixture();
  expect(await writeWeeklyReset(db, actor, command, "receipt-a")).toEqual({
    status: 200,
    body: {
      receipt: {
        ...scope,
        protocol: WEEKLY_RESET_PROTOCOL,
        familyId: "family-a",
        userId: "user-a",
        action: "start",
        revision: 1,
      },
    },
  });
  expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  expect(tx.$executeRaw.mock.calls[0].slice(2)).toEqual([
    "user-a",
    "family-a",
    0,
  ]);
  expect(tx.idempotencyRecord.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: "receipt-a",
        family_id: "family-a",
        user_id: "user-a",
      }),
    }),
  );
  expect(tx.idempotencyRecord.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ response_status: 200 }),
    }),
  );
});
it("refuses another account's command and an expired intent without progress writes", async () => {
  for (const patch of [
    { userId: "user-b" },
    { issuedAt: "2026-01-01T00:00:00.000Z" },
  ]) {
    const { db, tx } = fixture();
    await expect(
      writeWeeklyReset(db, actor, { ...command, ...patch }, "receipt-a"),
    ).rejects.toThrow();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  }
});
it("replays a completed effect without a second progress change, after fresh authority", async () => {
  const { db, tx } = fixture({ revision: 5 });
  const body = {
    receipt: {
      ...scope,
      protocol: WEEKLY_RESET_PROTOCOL,
      familyId: "family-a",
      userId: "user-a",
      action: "start",
      revision: 1,
    },
  };
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    response_status: 200,
    response_body: body,
  });
  expect(await writeWeeklyReset(db, actor, command, "receipt-a")).toEqual({
    status: 200,
    body,
  });
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it("projects only current role steps and keeps a different week unstarted without erasure", async () => {
  const { db, tx } = fixture({
    revision: 2,
    role: "child",
    progress: {
      ...scope,
      protocol: WEEKLY_RESET_PROTOCOL,
      familyId: "family-a",
      steps: { meals: "reviewed" },
      finishedAt: null,
    },
  });
  const result = await readWeeklyReset(db, actor, {
    ...scope,
    weekStart: "2026-10-26",
  });
  expect(result.started).toBe(false);
  expect(result.revision).toBe(2);
  expect(result.steps.some((row) => row.id === "meals")).toBe(false);
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
