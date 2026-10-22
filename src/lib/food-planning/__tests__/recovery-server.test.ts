/** Authored/unrun. Receipt/source boundaries; real PostgreSQL acceptance separate. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-recovery-key",
}));
jest.mock("../persist", () => ({
  authorizeFoodWriteInTx: jest.fn(async () => ({ inventoryEnabled: true })),
}));
jest.mock("../review", () => ({ createFoodWriteSourceGuard: jest.fn() }));
jest.mock("../owner", () => ({ foodWritingEnabled: jest.fn(() => true) }));
import { authorizeFoodWriteInTx } from "../persist";
import { createFoodWriteSourceGuard } from "../review";
import { foodWritingEnabled } from "../owner";
import { issueFoodReviewSeal, FoodReviewRefused } from "../review-proof";
import { inspectFoodRequest } from "../recovery-server";
import { FOOD_APPLY_ACTION } from "../apply-contract";
import { hashIdempotentRequest } from "../../idempotency";
import {
  actor,
  now,
  makeCommand,
  makeEntry,
  receipt,
  context,
} from "./recovery-fixture";
function fixture() {
  const command = makeCommand();
  command.reviewProof = issueFoodReviewSeal(
    actor,
    command,
    "a".repeat(64),
    {},
    now,
  );
  const entry = makeEntry(command);
  const record = {
    family_id: actor.familyId,
    user_id: actor.userId,
    action: FOOD_APPLY_ACTION,
    request_hash: hashIdempotentRequest(FOOD_APPLY_ACTION, command),
    response_status: null as number | null,
    response_body: null as unknown,
    created_at: new Date(+now - 31000),
    expires_at: new Date(+now + 86400000),
  };
  const tx = {
    idempotencyRecord: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const db = {
    $transaction: jest.fn(async (run: (client: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  const guard = { verify: jest.fn(async () => {}), assertCurrent: jest.fn() };
  jest.mocked(createFoodWriteSourceGuard).mockReturnValue(guard);
  return { command, entry, record, tx, db, guard };
}
beforeEach(() => {
  jest.mocked(foodWritingEnabled).mockReturnValue(true);
  jest
    .mocked(authorizeFoodWriteInTx)
    .mockResolvedValue({ inventoryEnabled: true });
});
afterEach(() => jest.clearAllMocks());
it("returns a completed matching receipt before checking expiry, rollout, targets or source storage", async () => {
  const { entry, record, tx, db, guard } = fixture();
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record,
    response_status: 201,
    response_body: receipt(),
  });
  jest.mocked(foodWritingEnabled).mockReturnValue(false);
  const result = await inspectFoodRequest(
    db as never,
    actor,
    entry,
    context().owner!.scope,
    new Date(+now + 8 * 86400000),
  );
  expect(result).toMatchObject({
    state: "committed",
    canRetry: false,
    retryUntil: null,
    receipt: receipt(),
  });
  expect(guard.verify).not.toHaveBeenCalled();
});
it("distinguishes a live request from missing or abandoned requests; only exact renewed requests can retry", async () => {
  const { entry, record, tx, db, guard } = fixture();
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record,
    created_at: new Date(+now - 1000),
  });
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("pending");
  expect(guard.verify).not.toHaveBeenCalled();
  for (const stored of [null, record]) {
    tx.idempotencyRecord.findFirst.mockResolvedValue(stored);
    expect(
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      ),
    ).toMatchObject({
      state: "ready",
      canRetry: true,
      retryUntil: new Date(+now + 60000).toISOString(),
      receipt: null,
    });
  }
  expect(guard.verify).toHaveBeenLastCalledWith(
    tx,
    actor,
    expect.objectContaining({
      reviewProof: JSON.parse(entry.body).reviewProof,
    }),
  );
});
it("does not infer a failed save from missing/expired records or source failures", async () => {
  const { entry, db, guard } = fixture();
  expect(
    await inspectFoodRequest(
      db as never,
      actor,
      entry,
      context().owner!.scope,
      new Date(+now + 60001),
    ),
  ).toMatchObject({ state: "expired", canRetry: false, receipt: null });
  jest.mocked(foodWritingEnabled).mockReturnValue(false);
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("paused");
  jest.mocked(foodWritingEnabled).mockReturnValue(true);
  guard.verify.mockRejectedValueOnce(new Error("synthetic source unavailable"));
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("unavailable");
  guard.verify.mockRejectedValueOnce(new FoodReviewRefused());
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("conflict");
});
it("refuses a changed original role/generation even when the new login currently authorizes", async () => {
  const { entry, db, tx } = fixture();
  for (const current of [
    { ...actor, generation: 1 },
    { ...actor, role: "teen" },
  ])
    await expect(
      inspectFoodRequest(
        db as never,
        current,
        entry,
        context().owner!.scope,
        now,
      ),
    ).rejects.toThrow();
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
});
it("refuses reused keys and structurally mismatched receipts without source dispatch", async () => {
  const { entry, record, tx, db, guard } = fixture();
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record,
    request_hash: "d".repeat(64),
  });
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("conflict");
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    ...record,
    response_status: 201,
    response_body: { ...receipt(), meals: [] },
  });
  expect(
    (
      await inspectFoodRequest(
        db as never,
        actor,
        entry,
        context().owner!.scope,
        now,
      )
    ).state,
  ).toBe("unavailable");
  expect(guard.verify).not.toHaveBeenCalled();
});
