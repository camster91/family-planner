/** Authored recovery cases. No DB, API or provider execution. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency";
import { reviewScheduleRequest } from "../schedule-recovery-server";
import {
  openScheduleActorInTx,
  prepareScheduleInTx,
} from "../schedule-runtime";
import { scheduleReviewWritingEnabled } from "../schedule-owner";
import { SCHEDULE_ACTION } from "../schedule-http";
import {
  actor,
  command,
  entry,
  receipt,
  snapshot,
  context,
  now,
} from "./schedule-fixture";
jest.mock("../schedule-runtime", () => ({
  ...jest.requireActual("../schedule-runtime"),
  openScheduleActorInTx: jest.fn(),
  prepareScheduleInTx: jest.fn(),
}));
jest.mock("../schedule-owner", () => ({
  scheduleReviewWritingEnabled: jest.fn(() => true),
}));
function fixture(record: unknown = null) {
  const tx = { idempotencyRecord: { findFirst: jest.fn(async () => record) } };
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  jest
    .mocked(openScheduleActorInTx)
    .mockResolvedValue({ role: "parent", features: defaultFeatures() });
  jest
    .mocked(prepareScheduleInTx)
    .mockResolvedValue({ snapshot, compared: [], sourceStatuses: [] });
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(true);
  return { tx, db };
}
beforeEach(() => jest.resetAllMocks());
it("inspects a valid original request without applying an effect or replacing its body", async () => {
  const { db } = fixture();
  const result = await reviewScheduleRequest(
    db,
    actor,
    entry,
    context.owner!.scope,
    now,
  );
  expect(result).toMatchObject({
    state: "ready",
    canRetry: true,
    currentSnapshotToken: command.snapshotToken,
    entry,
  });
});
it("returns only matching historical proof before target access, even when old or write-paused", async () => {
  const { db } = fixture({
    family_id: actor.familyId,
    user_id: actor.userId,
    action: SCHEDULE_ACTION,
    request_hash: hashIdempotentRequest(SCHEDULE_ACTION, command),
    response_status: 200,
    response_body: receipt,
  });
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(false);
  jest
    .mocked(prepareScheduleInTx)
    .mockRejectedValue(new Error("Deleted target"));
  expect(
    await reviewScheduleRequest(
      db,
      actor,
      entry,
      context.owner!.scope,
      new Date("2026-10-30T07:00:00Z"),
    ),
  ).toMatchObject({ state: "committed", canRetry: false, receipt });
  expect(prepareScheduleInTx).not.toHaveBeenCalled();
});
it("holds expired, paused and demoted unconfirmed requests without target/directory access", async () => {
  const { db } = fixture();
  expect(
    (
      await reviewScheduleRequest(
        db,
        actor,
        entry,
        context.owner!.scope,
        new Date("2026-10-20T07:16:00Z"),
      )
    ).state,
  ).toBe("expired");
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(false);
  expect(
    (await reviewScheduleRequest(db, actor, entry, context.owner!.scope, now))
      .state,
  ).toBe("paused");
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(true);
  jest
    .mocked(openScheduleActorInTx)
    .mockResolvedValue({ role: "child", features: defaultFeatures() });
  expect(
    (await reviewScheduleRequest(db, actor, entry, context.owner!.scope, now))
      .state,
  ).toBe("conflict");
  expect(prepareScheduleInTx).not.toHaveBeenCalled();
});
it("does not turn transaction/read failures into an empty successful review or permit a different hash", async () => {
  const { db } = fixture();
  jest
    .mocked(prepareScheduleInTx)
    .mockRejectedValue(new Error("Database unavailable"));
  await expect(
    reviewScheduleRequest(db, actor, entry, context.owner!.scope, now),
  ).rejects.toThrow("Database unavailable");
  const other = fixture({
    family_id: actor.familyId,
    user_id: actor.userId,
    action: SCHEDULE_ACTION,
    request_hash: "other-hash",
    response_status: 200,
    response_body: receipt,
  });
  await expect(
    reviewScheduleRequest(other.db, actor, entry, context.owner!.scope, now),
  ).rejects.toMatchObject({ code: "STALE" });
});
