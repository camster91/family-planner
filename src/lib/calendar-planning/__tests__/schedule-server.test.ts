/** Authored atomic-layer/receipt cases. Fakes do not prove PostgreSQL rollback. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { writeScheduleMove } from "../schedule-server";
import {
  openScheduleActorInTx,
  prepareScheduleInTx,
} from "../schedule-runtime";
import { applyComparedScheduleMoveInTx } from "../schedule-source";
import { scheduleReviewWritingEnabled } from "../schedule-owner";
import {
  SCHEDULE_REVIEW_PROTOCOL,
  previewScheduleMove,
  type ScheduleReviewSnapshot,
  type ScheduleReviewQuery,
} from "../conflict-review";
import { scheduleReceiptMatches } from "../schedule-http";
jest.mock("../schedule-runtime", () => ({
  ...jest.requireActual("../schedule-runtime"),
  openScheduleActorInTx: jest.fn(),
  prepareScheduleInTx: jest.fn(),
}));
jest.mock("../schedule-source", () => ({
  ...jest.requireActual("../schedule-source"),
  applyComparedScheduleMoveInTx: jest.fn(),
}));
jest.mock("../schedule-owner", () => ({
  scheduleReviewWritingEnabled: jest.fn(() => true),
}));
const actor = { userId: "parent-a", familyId: "family-a", tokenVersion: 0 },
  now = new Date("2026-10-20T07:00:00Z"),
  key = "schedule_request_a";
const snapshot: ScheduleReviewSnapshot = {
  protocol: SCHEDULE_REVIEW_PROTOCOL,
  owner: { userId: actor.userId, familyId: actor.familyId },
  role: "parent",
  timeZone: "America/Toronto",
  range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
  snapshotToken: "a".repeat(64),
  coverage: {
    complete: true,
    recurrence: "complete",
    capped: false,
    sourcesUnavailable: false,
  },
  events: [
    {
      id: "event-a",
      title: "Example event",
      start: "2026-10-20T10:00:00Z",
      end: "2026-10-20T11:00:00Z",
      sourceToken: "b".repeat(64),
      origin: "local",
      repeating: false,
      canMove: true,
    },
  ],
};
const query: ScheduleReviewQuery = {
  protocol: SCHEDULE_REVIEW_PROTOCOL,
  owner: snapshot.owner,
  range: snapshot.range,
  timeZone: snapshot.timeZone,
  snapshotToken: snapshot.snapshotToken,
  target: { id: "event-a", sourceToken: "b".repeat(64) },
  buffers: { preparation: 0, travelBefore: 0, travelAfter: 0 },
  otherBuffers: [],
  windows: [{ start: "2026-10-20T08:00:00Z", end: "2026-10-20T16:00:00Z" }],
  gridMinutes: 15,
};
// With no blockers, the closest different grid point is 09:45 (tie before 10:15).
const command = previewScheduleMove(
  snapshot,
  query,
  { start: "2026-10-20T09:45:00.000Z", end: "2026-10-20T10:45:00.000Z" },
  now,
);
function fixture() {
  const tx = {
    activity: { create: jest.fn(async () => ({ id: "fixture-activity" })) },
    $queryRaw: jest.fn(async () => []),
    idempotencyRecord: {
      findFirst: jest.fn(async () => ({
        response_status: null as number | null,
        response_body: null as unknown,
      })),
      update: jest.fn(async () => ({})),
    },
  };
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  const prepared = {
    snapshot,
    compared: [
      {
        id: "event-a",
        generation: "52d281b8-bffc-4d66-acda-f6f7adb65f7f",
        epoch: 0,
      },
    ],
    sourceStatuses: [],
  };
  jest
    .mocked(openScheduleActorInTx)
    .mockResolvedValue({ role: "parent", features: defaultFeatures() });
  jest.mocked(prepareScheduleInTx).mockResolvedValue(prepared);
  jest.mocked(applyComparedScheduleMoveInTx).mockResolvedValue({
    id: "event-a",
    generation: prepared.compared[0].generation,
    epoch: 1,
    start: new Date(command.start),
    end: new Date(command.end),
  });
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(true);
  return { tx, db, prepared };
}
beforeEach(() => jest.resetAllMocks());
it("places the guarded canonical effect and exact minimal receipt in the same callback", async () => {
  const { db, tx } = fixture();
  const result = await writeScheduleMove(
    db,
    actor,
    command,
    key,
    "receipt-a",
    now,
  );
  expect(applyComparedScheduleMoveInTx).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      familyId: actor.familyId,
      targetId: "event-a",
      start: command.start,
      end: command.end,
    }),
  );
  expect(scheduleReceiptMatches(result.body, command, key)).toBe(true);
  expect(JSON.stringify(result.body)).not.toMatch(
    /Example event|events|description|sourceStatuses/,
  );
  expect(
    tx.idempotencyRecord.update.mock.invocationCallOrder[0],
  ).toBeGreaterThan(
    jest.mocked(applyComparedScheduleMoveInTx).mock.invocationCallOrder[0],
  );
});
it("completed takeover returns original proof without reapplying after age or target changes", async () => {
  const { db, tx } = fixture();
  const saved = (
    await writeScheduleMove(db, actor, command, key, "receipt-a", now)
  ).body;
  jest.mocked(applyComparedScheduleMoveInTx).mockClear();
  jest.mocked(prepareScheduleInTx).mockClear();
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    response_status: 200,
    response_body: saved,
  });
  await expect(
    writeScheduleMove(
      db,
      actor,
      command,
      key,
      "receipt-a",
      new Date("2026-10-30T07:00:00Z"),
    ),
  ).resolves.toEqual({ status: 200, body: saved });
  expect(applyComparedScheduleMoveInTx).not.toHaveBeenCalled();
  expect(prepareScheduleInTx).not.toHaveBeenCalled();
});
it("refuses a paused writer, demoted actor and changed snapshot before any time effect", async () => {
  const { db, prepared } = fixture();
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(false);
  await expect(
    writeScheduleMove(db, actor, command, key, "receipt-a", now),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  jest.mocked(scheduleReviewWritingEnabled).mockReturnValue(true);
  jest
    .mocked(openScheduleActorInTx)
    .mockResolvedValue({ role: "child", features: defaultFeatures() });
  await expect(
    writeScheduleMove(db, actor, command, key, "receipt-a", now),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  jest
    .mocked(openScheduleActorInTx)
    .mockResolvedValue({ role: "parent", features: defaultFeatures() });
  jest.mocked(prepareScheduleInTx).mockResolvedValue({
    ...prepared,
    snapshot: { ...snapshot, snapshotToken: "c".repeat(64) },
  });
  await expect(
    writeScheduleMove(db, actor, command, key, "receipt-a", now),
  ).rejects.toMatchObject({ code: "STALE" });
  expect(applyComparedScheduleMoveInTx).not.toHaveBeenCalled();
});
it("does not return confirmation when the atomic comparison or receipt persistence fails", async () => {
  const { db, tx } = fixture();
  jest
    .mocked(applyComparedScheduleMoveInTx)
    .mockRejectedValueOnce(new Error("Changed comparison"));
  await expect(
    writeScheduleMove(db, actor, command, key, "receipt-a", now),
  ).rejects.toThrow();
  expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  tx.idempotencyRecord.update.mockRejectedValueOnce(
    new Error("Receipt write failed"),
  );
  await expect(
    writeScheduleMove(db, actor, command, key, "receipt-a", now),
  ).rejects.toThrow("Receipt write failed");
});
