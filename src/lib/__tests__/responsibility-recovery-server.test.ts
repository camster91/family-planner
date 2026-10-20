/** Source cases only. No actual receipt/target/transaction was queried. */
import type { PrismaClient } from "@prisma/client";
import { reviewResponsibilityRequest } from "@/lib/responsibility-recovery-server";
import {
  prepareResponsibilityInTx,
  openResponsibilityActorInTx,
  renewResponsibilityReceiptActorInTx,
} from "@/lib/responsibility-runtime";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  RESPONSIBILITY_PROTOCOL,
  type ResponsibilityContext,
} from "@/lib/responsibility";
jest.mock("@/lib/responsibility-runtime", () => ({
  prepareResponsibilityInTx: jest.fn(),
  openResponsibilityActorInTx: jest.fn(),
  renewResponsibilityReceiptActorInTx: jest.fn(),
}));
const actor = {
    userId: "parent-a",
    familyId: "family-a",
    role: "parent",
    tokenVersion: 0,
  },
  now = new Date("2026-10-20T16:00:00Z");
const command = {
  protocol: RESPONSIBILITY_PROTOCOL,
  userId: actor.userId,
  familyId: actor.familyId,
  target: { kind: "chore" as const, id: "chore-a" },
  action: "state-intent",
  slot: "primary",
  decision: "accepted",
  method: "self",
  sourceToken: "a".repeat(64),
  expectedRevision: 0,
  issuedAt: now.toISOString(),
};
const entry = {
    kind: "responsibility" as const,
    key: "responsibility_request_a",
    body: JSON.stringify(command),
  },
  scope = "b".repeat(64);
const context: ResponsibilityContext = {
  actor: { kind: "person", ...actor },
  target: {
    ...command.target,
    familyId: actor.familyId,
    sourceToken: command.sourceToken,
    active: true,
    primary: { kind: "account", accountId: actor.userId },
  },
  writesEnabled: true,
  eligibleSubjects: [{ kind: "account", accountId: actor.userId }],
  eligibleCoordinators: [],
  statementActorIds: [actor.userId],
};
function fixture(record: unknown = null) {
  const tx = {
    idempotencyRecord: { findFirst: jest.fn(async () => record) },
    $executeRaw: jest.fn(),
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
    .mockResolvedValue({
      current: null,
      context,
      projection: { stored: { revision: 0 } },
    } as unknown as Awaited<ReturnType<typeof prepareResponsibilityInTx>>);
});
it("reviews an exact pending intent without executing an effect", async () => {
  const f = fixture();
  const result = await reviewResponsibilityRequest(
    f.db,
    actor,
    entry,
    scope,
    now,
  );
  expect(result).toMatchObject({
    state: "ready",
    canRetry: true,
    currentRevision: 0,
    receipt: null,
    entry,
  });
  expect(f.tx.$executeRaw).not.toHaveBeenCalled();
});
it("keeps cached proof minimal and independent of later target access/expiry without claiming current acceptance", async () => {
  const receipt = {
    receipt: {
      protocol: RESPONSIBILITY_PROTOCOL,
      userId: actor.userId,
      familyId: actor.familyId,
      target: command.target,
      action: command.action,
      sourceToken: command.sourceToken,
      requestKey: entry.key,
      revision: 1,
    },
  };
  const f = fixture({
    family_id: actor.familyId,
    user_id: actor.userId,
    action: "responsibility.intent.v1",
    request_hash: hashIdempotentRequest("responsibility.intent.v1", command),
    response_status: 200,
    response_body: receipt,
  });
  const result = await reviewResponsibilityRequest(
    f.db,
    actor,
    entry,
    scope,
    new Date("2026-10-30"),
  );
  expect(result).toMatchObject({
    state: "committed",
    canRetry: false,
    currentRevision: null,
    receipt,
  });
  expect(prepareResponsibilityInTx).not.toHaveBeenCalled();
  expect(renewResponsibilityReceiptActorInTx).toHaveBeenCalled();
});
it("holds changed intent hashes without returning old proof or querying a target", async () => {
  const f = fixture({
    family_id: actor.familyId,
    user_id: actor.userId,
    action: "responsibility.intent.v1",
    request_hash: "different",
    response_status: 200,
    response_body: { private: "must not escape" },
  });
  await expect(
    reviewResponsibilityRequest(f.db, actor, entry, scope, now),
  ).rejects.toThrow("CONFLICT");
  expect(prepareResponsibilityInTx).not.toHaveBeenCalled();
});
it("cannot retry expired or paused intents", async () => {
  const f = fixture();
  expect(
    (
      await reviewResponsibilityRequest(
        f.db,
        actor,
        entry,
        scope,
        new Date(now.getTime() + 16 * 60000),
      )
    ).state,
  ).toBe("expired");
  expect(prepareResponsibilityInTx).not.toHaveBeenCalled();
  jest
    .mocked(prepareResponsibilityInTx)
    .mockResolvedValue({
      current: null,
      context: { ...context, writesEnabled: false },
      projection: { stored: { revision: 0 } },
    } as unknown as Awaited<ReturnType<typeof prepareResponsibilityInTx>>);
  expect(
    await reviewResponsibilityRequest(f.db, actor, entry, scope, now),
  ).toMatchObject({ state: "paused", canRetry: false });
});
