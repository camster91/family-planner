/** Source cases only. No actual authorization locks or database execution. */
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "@/lib/features";
import { readScheduleSnapshot } from "../schedule-runtime";
import {
  lockScheduleTarget,
  readScheduleComparisonInTx,
} from "../schedule-source";
import { readScheduleStatuses } from "../schedule-status";
jest.mock("../schedule-source", () => ({
  ...jest.requireActual("../schedule-source"),
  lockScheduleTarget: jest.fn(),
  readScheduleComparisonInTx: jest.fn(),
}));
jest.mock("../schedule-status", () => ({
  ...jest.requireActual("../schedule-status"),
  readScheduleStatuses: jest.fn(),
}));
const actor = { userId: "parent-a", familyId: "family-a", tokenVersion: 2 };
const scope = {
  targetId: "event-a",
  range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
  timeZone: "America/Toronto",
};
const row = {
  id: scope.targetId,
  generation: "b099dfbc-36f7-48e3-b98b-8073615bad64",
  epoch: 0,
  title: "Household event",
  start: new Date("2026-10-20T10:00:00Z"),
  end: new Date("2026-10-20T11:00:00Z"),
  recurrence: null,
  sourceSubscriptionId: null,
  sourceConnectionId: null,
};
function fixture() {
  const user = {
    id: actor.userId,
    family_id: actor.familyId,
    role: "parent",
    token_version: actor.tokenVersion,
  };
  const family = { features: defaultFeatures() };
  const order: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes('FROM "User"')) {
        order.push("user");
        return [user];
      }
      if (text.includes('FROM "Family"')) {
        order.push("family");
        return [family];
      }
      return [];
    }),
  };
  jest.mocked(lockScheduleTarget).mockImplementation(async () => {
    order.push("target");
    return { ...row, sourceToken: "a".repeat(64) };
  });
  jest.mocked(readScheduleComparisonInTx).mockImplementation(async () => {
    order.push("comparison");
    return [row];
  });
  jest.mocked(readScheduleStatuses).mockResolvedValue([]);
  const db = {
    $transaction: async (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  return { user, family, db, order };
}
beforeEach(() => jest.resetAllMocks());
it("renews identity and Family before target and comparison, projecting no notes or account/provider secrets", async () => {
  const { db, order } = fixture();
  jest.mocked(readScheduleComparisonInTx).mockResolvedValue([
    {
      ...row,
      description: "PRIVATE NOTE",
      email: "PRIVATE EMAIL",
      access_token_enc: "PRIVATE TOKEN",
    } as typeof row,
  ]);
  const reply = await readScheduleSnapshot(db, actor, scope);
  expect(order.slice(0, 3)).toEqual(["user", "family", "target"]);
  expect(reply.snapshot.events[0]).toMatchObject({
    id: scope.targetId,
    title: row.title,
    canMove: true,
    origin: "local",
  });
  expect(JSON.stringify(reply)).not.toMatch(
    /PRIVATE|description|access_token|generation/,
  );
});
it("rejects moved-family, stale-token and unknown-role actors before any target access", async () => {
  for (const change of [
    (user: { family_id: string }) => {
      user.family_id = "other-family";
    },
    (user: { token_version: number }) => {
      user.token_version++;
    },
    (user: { role: string }) => {
      user.role = "unknown";
    },
  ]) {
    jest.clearAllMocks();
    const { db, user } = fixture();
    change(user);
    await expect(readScheduleSnapshot(db, actor, scope)).rejects.toThrow();
    expect(lockScheduleTarget).not.toHaveBeenCalled();
  }
});
it("respects the current calendar feature and never grants read-only roles move permission", async () => {
  const { db, user, family } = fixture();
  family.features.calendar = false;
  await expect(readScheduleSnapshot(db, actor, scope)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(lockScheduleTarget).not.toHaveBeenCalled();
  family.features.calendar = true;
  user.role = "child";
  const reply = await readScheduleSnapshot(db, actor, scope);
  expect(reply.snapshot.role).toBe("child");
  expect(reply.snapshot.events[0].canMove).toBe(false);
});
it("marks failed/pending sources and caps as incomplete, retaining the target in a bounded preview", async () => {
  const { db } = fixture();
  jest.mocked(readScheduleStatuses).mockResolvedValue([
    {
      kind: "connection",
      id: "source-a",
      status: "pending",
      checkedAt: null,
      updatedAt: new Date("2026-10-20T00:00:00Z"),
      generation: 0,
    },
  ]);
  jest.mocked(readScheduleComparisonInTx).mockResolvedValue([
    row,
    ...Array.from({ length: 500 }, (_, index) => ({
      ...row,
      id: `event-${index}`,
    })),
  ]);
  const reply = await readScheduleSnapshot(db, actor, scope);
  expect(reply.snapshot.events).toHaveLength(500);
  expect(reply.snapshot.events[0].id).toBe(scope.targetId);
  expect(reply.snapshot.coverage).toMatchObject({
    complete: false,
    capped: true,
    sourcesUnavailable: true,
  });
});
it("holds a source refresh changing while projection is read rather than returning a false empty/complete result", async () => {
  const { db } = fixture();
  jest
    .mocked(readScheduleStatuses)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        kind: "subscription",
        id: "source-a",
        status: "ok",
        checkedAt: new Date(),
        updatedAt: new Date(),
        generation: null,
      },
    ]);
  await expect(readScheduleSnapshot(db, actor, scope)).rejects.toMatchObject({
    code: "STALE",
  });
});

it("marks an OK but old source as uncertain rather than current availability", async () => {
  const { db } = fixture();
  jest
    .mocked(readScheduleStatuses)
    .mockResolvedValue([
      {
        kind: "subscription",
        id: "source-a",
        status: "ok",
        checkedAt: new Date("2026-10-18T00:00:00Z"),
        updatedAt: new Date("2026-10-18T00:00:00Z"),
        generation: null,
      },
    ]);
  const result = await readScheduleSnapshot(
    db,
    actor,
    scope,
    new Date("2026-10-20T07:00:00Z"),
  );
  expect(result.snapshot.coverage).toMatchObject({
    sourcesUnavailable: true,
    complete: false,
  });
});
