// Native D1 kid home reads (owner review 2026-11-19): besides the bounded
// own-chore window and catch-up reads, the kid home reads the viewer's own
// chores waiting for a parent's check and the viewer's own claimed rewards.
// Every read is pinned to the caller's household and, for own items, to the
// caller: another member's or another household's rows are never asked for.

const choreCalls: any[] = [];
const rewardCalls: any[] = [];
const fakeDb = {
  chore: {
    findMany: jest.fn(async (args: any) => {
      choreCalls.push(args);
      return [];
    }),
  },
  event: { findMany: jest.fn(async () => []) },
  reward: {
    findMany: jest.fn(async (args: any) => {
      rewardCalls.push(args);
      return args.where.status === "claimed"
        ? [{ id: "mine", status: "claimed" }]
        : [{ id: "free", status: "available" }];
    }),
  },
};
jest.mock("../database", () => ({ getD1Database: jest.fn(async () => ({})) }));
jest.mock("../read-client", () => ({
  withD1ReadClient: async (fn: any) => fn(fakeDb),
}));
jest.mock("@/lib/chore-read-scope", () => ({
  withChoreReads: async (fn: any) => fn(fakeDb),
}));
jest.mock("../chore-read-policy", () => ({
  hiddenD1RoutineOccurrenceIds: async () => [],
}));

import { readD1KidDashboardData } from "../kid-dashboard";

beforeEach(() => {
  choreCalls.length = 0;
  rewardCalls.length = 0;
});

const NOW = new Date("2026-10-06T12:00:00Z");

describe("readD1KidDashboardData", () => {
  it.each([
    ["kid-a", "family-A"],
    ["kid-b", "family-B"],
  ])("reads %s's own waiting chores and claims in %s only", async (userId, familyId) => {
    const [, , , rewards, waiting] = await readD1KidDashboardData(
      familyId,
      userId,
      NOW,
      true,
      {} as any,
    );
    expect(waiting).toEqual([]);
    // Every chore read is own and household-scoped.
    for (const args of choreCalls) {
      expect(args.where.family_id).toBe(familyId);
      expect(args.where.assigned_to).toBe(userId);
    }
    const waitingRead = choreCalls.find((a) => a.where.status === "completed");
    expect(waitingRead.where.due_date).toEqual({
      lt: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(rewardCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { family_id: familyId, status: "available", is_active: true },
        }),
        expect.objectContaining({
          where: { family_id: familyId, status: "claimed", claimed_by: userId },
          take: 5,
        }),
      ]),
    );
    expect(rewards.map((r: any) => r.id)).toEqual(["free", "mine"]);
  });

  it("reads no rewards at all with Rewards off", async () => {
    const [, , , rewards] = await readD1KidDashboardData(
      "family-A",
      "kid-a",
      NOW,
      false,
      {} as any,
    );
    expect(rewards).toEqual([]);
    expect(rewardCalls).toEqual([]);
  });
});
