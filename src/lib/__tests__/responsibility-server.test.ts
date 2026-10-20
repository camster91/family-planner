/** Atomic layering source cases. Real transaction/FK/takeover acceptance remains unrun. */
import type { PrismaClient } from "@prisma/client";
import { writeResponsibility } from "@/lib/responsibility-server";
import {
  prepareResponsibilityInTx,
  openResponsibilityActorInTx,
  renewResponsibilityReceiptActorInTx,
} from "@/lib/responsibility-runtime";
import { persistResponsibilityStateInTx } from "@/lib/responsibility-state-store";
import {
  RESPONSIBILITY_PROTOCOL,
  type ResponsibilityContext,
} from "@/lib/responsibility";
jest.mock("@/lib/responsibility-runtime", () => ({
  openResponsibilityActorInTx: jest.fn(),
  renewResponsibilityReceiptActorInTx: jest.fn(),
  prepareResponsibilityInTx: jest.fn(),
}));
jest.mock("@/lib/responsibility-state-store", () => ({
  persistResponsibilityStateInTx: jest.fn(async () => "state-a"),
}));
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  tokenVersion: 0,
};
const now = new Date("2026-10-20T16:00:00Z"),
  target = { kind: "chore" as const, id: "chore-a" },
  key = "responsibility_request_a";
const command = {
  protocol: RESPONSIBILITY_PROTOCOL,
  userId: actor.userId,
  familyId: actor.familyId,
  target,
  sourceToken: "a".repeat(64),
  expectedRevision: 0,
  issuedAt: now.toISOString(),
  action: "state-intent" as const,
  slot: "primary" as const,
  decision: "accepted" as const,
  method: "self" as const,
};
const context: ResponsibilityContext = {
  actor: { kind: "person", ...actor },
  target: {
    ...target,
    familyId: actor.familyId,
    sourceToken: command.sourceToken,
    active: true,
    primary: { kind: "account", accountId: actor.userId },
  },
  eligibleSubjects: [{ kind: "account", accountId: actor.userId }],
  eligibleCoordinators: [],
  statementActorIds: [actor.userId],
  writesEnabled: true,
};
function fixture() {
  const tx = {
    $queryRaw: jest.fn(async () => []),
    idempotencyRecord: {
      findFirst: jest.fn(async () => ({
        response_status: null as number | null,
        response_body: null as unknown,
      })),
      update: jest.fn(),
    },
  };
  return {
    tx,
    db: {
      $transaction: async (run: (tx: unknown) => unknown) => run(tx),
    } as unknown as PrismaClient,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(openResponsibilityActorInTx).mockResolvedValue(undefined);
  jest.mocked(renewResponsibilityReceiptActorInTx).mockResolvedValue(undefined);
  jest
    .mocked(prepareResponsibilityInTx)
    .mockResolvedValue({ current: null, context } as unknown as Awaited<
      ReturnType<typeof prepareResponsibilityInTx>
    >);
});
it("stores a changed effect and minimal exact receipt in the same callback", async () => {
  const { db, tx } = fixture();
  const result = await writeResponsibility(
    db,
    actor,
    command,
    key,
    "receipt-a",
    now,
  );
  expect(persistResponsibilityStateInTx).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ revision: 1 }),
    0,
    null,
  );
  expect(tx.idempotencyRecord.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { response_status: 200, response_body: result.body },
    }),
  );
  expect(result.body).toEqual({
    receipt: {
      protocol: RESPONSIBILITY_PROTOCOL,
      userId: actor.userId,
      familyId: actor.familyId,
      target,
      action: command.action,
      sourceToken: command.sourceToken,
      requestKey: key,
      revision: 1,
    },
  });
  expect(tx.idempotencyRecord.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: "receipt-a",
        scope: `user:${actor.userId}`,
        key,
        family_id: actor.familyId,
        user_id: actor.userId,
        action: "responsibility.intent.v1",
      }),
    }),
  );
});
it("does not reapply a completed effect, even after age/target changes", async () => {
  const { db, tx } = fixture();
  const body = {
    receipt: {
      protocol: RESPONSIBILITY_PROTOCOL,
      userId: actor.userId,
      familyId: actor.familyId,
      target,
      action: command.action,
      sourceToken: command.sourceToken,
      requestKey: key,
      revision: 1,
    },
  };
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    response_status: 200,
    response_body: body,
  });
  expect(
    await writeResponsibility(
      db,
      actor,
      command,
      key,
      "receipt-a",
      new Date("2026-10-30"),
    ),
  ).toEqual({ status: 200, body });
  expect(prepareResponsibilityInTx).not.toHaveBeenCalled();
  expect(persistResponsibilityStateInTx).not.toHaveBeenCalled();
  expect(renewResponsibilityReceiptActorInTx).toHaveBeenCalled();
});
it("retains unknown receipt failures and refuses a different-account command before effects", async () => {
  const { db, tx } = fixture();
  tx.idempotencyRecord.update.mockRejectedValue(
    new Error("receipt write unavailable"),
  );
  await expect(
    writeResponsibility(db, actor, command, key, "receipt-a", now),
  ).rejects.toThrow("receipt write unavailable");
  jest.mocked(persistResponsibilityStateInTx).mockClear();
  await expect(
    writeResponsibility(
      db,
      actor,
      { ...command, userId: "other-user" },
      key,
      "receipt-a",
      now,
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(persistResponsibilityStateInTx).not.toHaveBeenCalled();
});
