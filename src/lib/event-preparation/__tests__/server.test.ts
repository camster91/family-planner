/** Authored/unrun. Faked transaction flow does not prove real PG rollback/locks. */
import type { PrismaClient } from "@prisma/client";
import { writeEventPreparation } from "../server";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
} from "../runtime";
import { eventPreparationWritingEnabled } from "../owner";
import { preparationReceiptMatches } from "../receipt-server";
import { actor, now, preparationTestFixture } from "./test-fixture";
import { preparationCopyFactId } from "../origin";
jest.mock("../runtime", () => ({
  openPreparationActorInTx: jest.fn(),
  prepareEventPreparationInTx: jest.fn(),
}));
jest.mock("../owner", () => ({
  eventPreparationWritingEnabled: jest.fn(() => true),
}));
const key = "event_preparation_request_a";
function fixture() {
  const { context, command } = preparationTestFixture();
  const prepared = { context, state: null } as Awaited<
    ReturnType<typeof prepareEventPreparationInTx>
  >;
  const tx = {
    activity: { create: jest.fn(async () => ({ id: "fixture-activity" })) },
    $queryRaw: jest.fn(async () => [
      { id: actor.userId, role: "parent", token_version: actor.tokenVersion },
    ]),
    $executeRaw: jest.fn(async () => 1),
    chore: {
      create: jest.fn(async () => ({ id: "created-chore-a" })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    idempotencyRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ response_status: null, response_body: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  jest.mocked(prepareEventPreparationInTx).mockResolvedValue(prepared);
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  return { db, tx, command, prepared };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(eventPreparationWritingEnabled).mockReturnValue(true);
});
it("records exact routine provenance in the effect transaction and never duplicates it on receipt replay", async () => {
  const { db, tx, command, prepared } = fixture();
  prepared.context.routine = {
    id: "stack-a",
    sourceToken: "d".repeat(64),
    occurrenceDay: "2026-10-20",
    complete: true,
    steps: [
      {
        id: "source-a",
        sourceToken: "c".repeat(64),
        copyable: true,
        content: {
          title: "Pack lunch",
          description: null,
          subject: { kind: "account", accountId: actor.userId },
          points: 20,
          difficulty: "easy",
          icon: null,
          durationMinutes: 5,
        },
      },
    ],
  };
  const reuse = {
    ...command,
    action: "reuse-routine" as const,
    stackId: "stack-a",
    sourceToken: "d".repeat(64),
    occurrenceDay: "2026-10-20",
    steps: [
      {
        sourceId: "source-a",
        sourceToken: "c".repeat(64),
        clientId: "new-step-a",
        subject: { kind: "account" as const, accountId: actor.userId },
        points: null,
        dueDay: "2026-10-21",
        cue: null,
      },
    ],
  };
  const result = await writeEventPreparation(
    db,
    actor,
    reuse,
    key,
    "record-a",
    now,
  );
  expect(result.status).toBe(200);
  expect(tx.activity.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        id: preparationCopyFactId(actor.familyId, "created-chore-a"),
        type: "preparation_routine_copied",
        metadata: JSON.stringify({
          timeline: 1,
          actorKind: "person",
          target: { kind: "chore", id: "created-chore-a" },
          routineCopy: {
            stackId: "stack-a",
            sourceChoreId: "source-a",
            occurrenceDay: "2026-10-20",
          },
        }),
      }),
    }),
  );
  const count = tx.activity.create.mock.calls.length;
  expect(count).toBe(2); // Copy fact and preparation-review fact, not a completion.
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    response_status: 200,
    response_body: result.body,
  });
  expect(
    await writeEventPreparation(db, actor, reuse, key, "record-a", now),
  ).toEqual(result);
  expect(tx.activity.create).toHaveBeenCalledTimes(count);
  expect(tx.chore.create).toHaveBeenCalledTimes(1);
});
it("creates fresh once-only canonical work and a minimal exact receipt, then replays without another clone or target read", async () => {
  const { db, tx, command } = fixture();
  const result = await writeEventPreparation(
    db,
    actor,
    command,
    key,
    "record-a",
    now,
  );
  expect(preparationReceiptMatches(result.body, command, key)).toBe(true);
  expect(openPreparationActorInTx).toHaveBeenCalledWith(tx, actor);
  expect(tx.chore.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        family_id: actor.familyId,
        title: "Pack lunch",
        points: 0,
        frequency: "once",
        status: "pending",
        recurrence_id: null,
        routine_stack_id: null,
        completed_at: null,
        verified_at: null,
      }),
    }),
  );
  expect(JSON.stringify(result.body)).not.toMatch(
    /Pack lunch|description|photo_url|email/,
  );
  expect(tx.idempotencyRecord.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { response_status: 200, response_body: result.body },
    }),
  );
  tx.idempotencyRecord.findFirst.mockResolvedValue({
    response_status: 200,
    response_body: result.body,
  });
  jest.mocked(eventPreparationWritingEnabled).mockReturnValue(false);
  const replay = await writeEventPreparation(
    db,
    actor,
    command,
    key,
    "record-a",
    new Date("2027-01-01Z"),
  );
  expect(replay).toEqual(result);
  expect(prepareEventPreparationInTx).toHaveBeenCalledTimes(1);
  expect(tx.chore.create).toHaveBeenCalledTimes(1);
  expect(tx.activity.create).toHaveBeenCalledTimes(1);
});
it("refuses stale source, no matching claim, wrong owner, paused writes and changed-token actor before canonical effects", async () => {
  for (const state of [
    "stale",
    "missing",
    "foreign",
    "paused",
    "token",
  ] as const) {
    const { db, tx, command, prepared } = fixture();
    if (state === "stale") prepared.context.viewToken = "c".repeat(64);
    if (state === "missing")
      tx.idempotencyRecord.findFirst.mockResolvedValue(null);
    if (state === "foreign") command.owner.familyId = "foreign";
    if (state === "paused")
      jest.mocked(eventPreparationWritingEnabled).mockReturnValue(false);
    if (state === "token")
      tx.$queryRaw.mockResolvedValue([
        { id: actor.userId, role: "parent", token_version: 999 },
      ]);
    await expect(
      writeEventPreparation(db, actor, command, key, "record-a", now),
    ).rejects.toThrow();
    expect(tx.chore.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    jest.clearAllMocks();
    jest.mocked(eventPreparationWritingEnabled).mockReturnValue(true);
  }
});
