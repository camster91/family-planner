/** Authored/unrun. Mocked transaction boundaries; DB proof is separate. */
jest.mock("../../meal-batch-api", () => ({
  authorizeMealBatchInTx: jest.fn(async () => null),
  persistMealPrepInTx: jest.fn(),
  batchFailure: (status: number, code: string) => ({
    status,
    body: { error: { code } },
  }),
}));
jest.mock("../owner", () => ({ prepRecoveryEnabled: jest.fn(() => true) }));
import type { PrismaClient } from "@prisma/client";
import { hashIdempotentRequest } from "../../idempotency";
import { persistMealPrepInTx } from "../../meal-batch-api";
import { prepRecoveryEnabled } from "../owner";
import { PREP_INTENT_MS, prepAction } from "../contract";
import { inspectOwnedPrep, persistOwnedPrep } from "../server";
import { actor, now, command, context, entry, receipt } from "./fixture";
function record() {
  return {
    user_id: actor.userId,
    family_id: actor.familyId,
    action: prepAction(command()),
    request_hash: hashIdempotentRequest(prepAction(command()), command()),
    response_status: 201 as number | null,
    response_body: receipt(),
    created_at: now,
    expires_at: new Date(+now + 7 * PREP_INTENT_MS),
  };
}
function fixture() {
  const tx = {
    user: { findUnique: jest.fn(async () => ({ role: actor.role })) },
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue(record()) },
    $queryRaw: jest.fn(async () => []),
  };
  const db = {
    $transaction: jest.fn(async (run: (value: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  return { tx, db: db as unknown as Pick<PrismaClient, "$transaction"> };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prepRecoveryEnabled).mockReturnValue(true);
  jest.spyOn(Date, "now").mockReturnValue(+now);
});
afterEach(() => jest.restoreAllMocks());
it("finds committed receipts before lease/readiness and without target reads", async () => {
  const { db } = fixture();
  jest.mocked(prepRecoveryEnabled).mockReturnValue(false);
  const result = await inspectOwnedPrep(
    db,
    actor,
    entry(),
    context().owner!.scope,
    new Date(+now + 10 * PREP_INTENT_MS),
  );
  expect(result.state).toBe("committed");
  expect(result.receipt).toEqual(receipt());
  expect(persistMealPrepInTx).not.toHaveBeenCalled();
});
it("distinguishes missing, pending, expired, paused and conflicting receipts without dispatch", async () => {
  const { tx, db } = fixture();
  tx.idempotencyRecord.findFirst.mockResolvedValue(null);
  expect(
    (await inspectOwnedPrep(db, actor, entry(), context().owner!.scope, now))
      .state,
  ).toBe("ready");
  expect(
    (
      await inspectOwnedPrep(
        db,
        actor,
        entry(),
        context().owner!.scope,
        new Date(+now + PREP_INTENT_MS),
      )
    ).state,
  ).toBe("expired");
  jest.mocked(prepRecoveryEnabled).mockReturnValue(false);
  expect(
    (await inspectOwnedPrep(db, actor, entry(), context().owner!.scope, now))
      .state,
  ).toBe("paused");
  jest.mocked(prepRecoveryEnabled).mockReturnValue(true);
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record(),
    response_status: null,
  });
  expect(
    (await inspectOwnedPrep(db, actor, entry(), context().owner!.scope, now))
      .state,
  ).toBe("pending");
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record(),
    family_id: "foreign-family",
  });
  expect(
    (await inspectOwnedPrep(db, actor, entry(), context().owner!.scope, now))
      .state,
  ).toBe("conflict");
  expect(persistMealPrepInTx).not.toHaveBeenCalled();
});
it("refuses role/generation changes before reading private receipt pointers", async () => {
  for (const changed of [
    { ...actor, role: "teen" },
    { ...actor, generation: 3 },
  ]) {
    const { tx, db } = fixture();
    await expect(
      inspectOwnedPrep(db, changed, entry(), context().owner!.scope, now),
    ).rejects.toThrow();
    expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  }
});
it("passes the frozen command to the canonical effect and throws non-success for rollback", async () => {
  const { tx, db } = fixture();
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record(),
    response_status: null,
  });
  jest
    .mocked(persistMealPrepInTx)
    .mockResolvedValueOnce({ status: 201, body: receipt() });
  expect(
    (await persistOwnedPrep(db, actor, command(), "reserved-root")).body,
  ).toEqual(receipt());
  expect(persistMealPrepInTx).toHaveBeenCalledWith(
    tx,
    {
      userId: actor.userId,
      familyId: actor.familyId,
      tokenVersion: actor.generation,
    },
    command().input,
    "reserved-root",
  );
  jest
    .mocked(persistMealPrepInTx)
    .mockResolvedValueOnce({
      status: 409,
      body: { error: { code: "STATE_CHANGED" } },
    });
  await expect(
    persistOwnedPrep(db, actor, command(), "reserved-root"),
  ).rejects.toThrow();
});
