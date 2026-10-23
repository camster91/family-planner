/** Authored/unrun. Mocked projection cases are not PostgreSQL isolation proof. */
jest.mock("@/lib/household-lock", () => ({
  lockUser: jest.fn(),
  lockHousehold: jest.fn(),
}));
jest.mock("@/lib/profile-chore-gates", () => ({
  isProfileChoreEnabled: () => false,
}));
import type { PrismaClient } from "@prisma/client";
import { readChangeTimeline, decodeTimelineCursor } from "../timeline";
const actor = {
  userId: "fixture-parent-a",
  familyId: "fixture-family-a",
  tokenVersion: 3,
};
const now = new Date("2026-10-22T12:00:00.000Z");
function fixture() {
  const tx = {
    user: {
      findUnique: jest.fn(async () => ({
        family_id: actor.familyId,
        role: "parent",
        token_version: 3,
      })),
    },
    family: {
      findUnique: jest.fn(async () => ({ features: { meals: true } })),
    },
    activity: { findMany: jest.fn(async () => [] as unknown[]) },
    auditLog: { findMany: jest.fn(async () => [] as unknown[]) },
    event: { findMany: jest.fn(async () => [] as unknown[]) },
    chore: { findMany: jest.fn(async () => [] as unknown[]) },
    recipe: { findMany: jest.fn(async () => [] as unknown[]) },
    handoff: { findMany: jest.fn(async () => [] as unknown[]) },
    pickup: { findMany: jest.fn(async () => [] as unknown[]) },
  };
  const db = {
    $transaction: (run: (value: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient;
  return { db, tx };
}
const change = (id: string, type: string, metadata: unknown = null) => ({
  id,
  type,
  metadata: metadata === null ? null : JSON.stringify(metadata),
  created_at: now,
  title: "Private old title",
  description: "Private notes",
  user: { name: "Current parent", family_id: actor.familyId },
});
it("renews role, household and session before reading history", async () => {
  for (const current of [
    { family_id: "fixture-family-b", role: "parent", token_version: 3 },
    { family_id: actor.familyId, role: "teen", token_version: 3 },
    { family_id: actor.familyId, role: "parent", token_version: 4 },
  ]) {
    const { db, tx } = fixture();
    tx.user.findUnique.mockResolvedValue(current);
    await expect(readChangeTimeline(db, actor, {}, now)).rejects.toThrow(
      "Timeline unavailable",
    );
    expect(tx.activity.findMany).not.toHaveBeenCalled();
    expect(tx.auditLog.findMany).not.toHaveBeenCalled();
  }
});
it("builds links from current household records and never from stored titles, summaries or URLs", async () => {
  const { db, tx } = fixture();
  tx.activity.findMany.mockResolvedValue([
    change("fixture-event-change", "event_created", {
      eventId: "fixture-event",
    }),
    change("fixture-foreign-change", "event_created", {
      eventId: "foreign-event",
      href: "https://foreign.invalid/private",
    }),
  ]);
  tx.event.findMany.mockResolvedValue([
    { id: "fixture-event", title: "Current event title" },
  ]);
  const result = await readChangeTimeline(db, actor, {}, now);
  expect(result.entries[0]).toMatchObject({
    title: "Current event title",
    target: { kind: "event", id: "fixture-event" },
  });
  expect(result.entries[1]).toMatchObject({
    title: null,
    target: null,
    current: "unavailable",
  });
  expect(JSON.stringify(result)).not.toMatch(
    /Private old|Private notes|foreign\.invalid/,
  );
  expect(tx.event.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        family_id: actor.familyId,
        id: { in: ["fixture-event", "foreign-event"] },
      },
    }),
  );
});
it("does not present a selected tablet subject or an older ambiguous completion as a person actor", async () => {
  const { db, tx } = fixture();
  tx.activity.findMany.mockResolvedValue([
    change("tablet", "chore_completed", {
      timeline: 1,
      actorKind: "device",
      target: { kind: "chore", id: "fixture-chore" },
    }),
    change("old", "chore_completed"),
    change("person", "chore_completed", {
      timeline: 1,
      actorKind: "person",
      target: { kind: "chore", id: "fixture-chore" },
    }),
  ]);
  const result = await readChangeTimeline(
    db,
    actor,
    { source: "coordination" },
    now,
  );
  expect(result.entries.map((row) => row.actor)).toEqual([
    { kind: "tablet", name: null },
    { kind: "unknown", name: null },
    { kind: "person", name: "Current parent" },
  ]);
});
it("keeps continuation through filtered-empty windows and binds cursors to their stream/filter", async () => {
  const { db, tx } = fixture();
  tx.family.findUnique.mockResolvedValue({ features: { meals: false } });
  tx.activity.findMany.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) =>
      change(`recipe-${i}`, "recipe_created", {
        timeline: 1,
        target: { kind: "recipe", id: `recipe-${i}` },
      }),
    ),
  );
  const first = await readChangeTimeline(
    db,
    actor,
    { source: "coordination" },
    now,
  );
  expect(first.entries).toEqual([]);
  expect(first.nextCursor).not.toBeNull();
  expect(tx.recipe.findMany).not.toHaveBeenCalled();
  const cursor = decodeTimelineCursor(first.nextCursor!, "coordination");
  expect(cursor?.id).toBe("recipe-19");
  expect(() => decodeTimelineCursor(first.nextCursor!, "all")).toThrow(
    "INVALID_TIMELINE_CURSOR",
  );
  await readChangeTimeline(
    db,
    actor,
    { source: "coordination", cursor: first.nextCursor! },
    now,
  );
  expect(tx.activity.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      take: 21,
      where: expect.objectContaining({
        family_id: actor.familyId,
        AND: expect.arrayContaining([
          {
            OR: [
              { created_at: { lt: now } },
              { created_at: now, id: { lt: "recipe-19" } },
            ],
          },
        ]),
      }),
    }),
  );
});
