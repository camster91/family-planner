/** Authored/unrun. Mock receipts/transactions do not prove live PG atomicity. */
import type { PrismaClient } from "@prisma/client";
import { reviewPreparationRequest } from "../recovery-server";
import { prepareEventPreparationInTx } from "../runtime";
import { eventPreparationWritingEnabled } from "../owner";
import { PREPARATION_ACTION } from "../http";
import { EventPreparationError } from "../contract";
import { actor, now } from "./test-fixture";
import { preparationRecoveryFixture } from "./recovery-fixture";
jest.mock("../runtime", () => ({
  openPreparationActorInTx: jest.fn(),
  prepareEventPreparationInTx: jest.fn(),
}));
jest.mock("../owner", () => ({
  eventPreparationWritingEnabled: jest.fn(() => true),
}));
function fixture() {
  const f = preparationRecoveryFixture();
  const record = {
    family_id: actor.familyId,
    user_id: actor.userId,
    action: PREPARATION_ACTION,
    request_hash: f.entry.requestHash,
    response_status: null as number | null,
    response_body: null as unknown,
  };
  const tx = {
    $queryRaw: jest.fn(async () => [
      { role: "parent", token_version: actor.tokenVersion },
    ]),
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue(record) },
  };
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  jest.mocked(prepareEventPreparationInTx).mockResolvedValue(f.prepared);
  return { ...f, record, tx, db };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(eventPreparationWritingEnabled).mockReturnValue(true);
});
it("inspects historical success before deleted source, expiry or paused readiness without task mutation", async () => {
  const f = fixture();
  f.record.response_status = 200;
  f.record.response_body = f.receipt;
  jest.mocked(eventPreparationWritingEnabled).mockReturnValue(false);
  jest
    .mocked(prepareEventPreparationInTx)
    .mockRejectedValue(new EventPreparationError("NOT_FOUND"));
  const review = await reviewPreparationRequest(
    f.db,
    actor,
    f.entry,
    f.recovery.owner!.scope,
    new Date("2027-01-01T00:00:00Z"),
  );
  expect(review).toMatchObject({
    state: "committed",
    canRetry: false,
    currentToken: null,
    receipt: f.receipt,
  });
  expect(prepareEventPreparationInTx).not.toHaveBeenCalled();
});
it("requires current exact sources before an explicit pending or new-key retry", async () => {
  const f = fixture();
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      now,
    ),
  ).toMatchObject({
    state: "pending",
    canRetry: true,
    currentToken: f.context.viewToken,
  });
  f.tx.idempotencyRecord.findFirst.mockResolvedValue(null);
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      now,
    ),
  ).toMatchObject({ state: "ready", canRetry: true });
  f.context.viewToken = "c".repeat(64);
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      now,
    ),
  ).toMatchObject({ state: "conflict", canRetry: false });
});
it("holds unknown acknowledgements, paused/expired work and mismatched digest or ownership instead of confirming", async () => {
  const f = fixture();
  f.record.response_status = 200;
  f.record.response_body = { success: true };
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      now,
    ),
  ).toMatchObject({ state: "unavailable", canRetry: false });
  f.record.response_status = null;
  jest.mocked(eventPreparationWritingEnabled).mockReturnValue(false);
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      now,
    ),
  ).toMatchObject({ state: "paused", canRetry: false });
  expect(
    await reviewPreparationRequest(
      f.db,
      actor,
      f.entry,
      f.recovery.owner!.scope,
      new Date("2026-10-21T00:00:00Z"),
    ),
  ).toMatchObject({ state: "expired", canRetry: false });
  await expect(
    reviewPreparationRequest(
      f.db,
      actor,
      { ...f.entry, requestHash: "f".repeat(64) },
      f.recovery.owner!.scope,
      now,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
});
