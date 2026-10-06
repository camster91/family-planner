import * as React from "react";
import DashboardPage from "../page";

const findMany = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({
        id: "kid",
        name: "Casey",
        role: "teen",
        family_id: "home",
        xp: 20,
        level: 1,
        family: { features: { gamification: false, rewards: true } },
      })),
    },
    chore: { findMany: (...args: unknown[]) => findMany(...args) },
    event: { findMany: jest.fn(async () => []) },
    reward: { findMany: jest.fn(async () => []) },
  },
}));
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "kid" }),
}));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/calendar-import/sync", () => ({
  refreshStaleSubscriptions: jest.fn(),
}));

it.each([
  [60, false],
  [61, true],
] as const)(
  "reports the near-day window cap for %s rows without widening household access",
  async (count, limited) => {
    findMany.mockReset();
    const near = Array.from({ length: count }, (_, i) => ({
      id: `near${i}`,
      due_date: new Date("2026-10-06"),
      status: "pending",
      points: 10,
    }));
    findMany.mockResolvedValueOnce(near).mockResolvedValueOnce([]);
    const result = (await DashboardPage()) as React.ReactElement;
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { family_id: "home", assigned_to: "kid" },
      take: 61,
    });
    expect(result.props.chores).toHaveLength(60);
    expect(result.props.workPreviewLimited).toBe(limited);
  },
);

it("loads a bounded own catch-up preview with explicit truncation rather than silently dropping work", async () => {
  findMany.mockReset();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-06T12:00:00Z"));
  try {
    const old = Array.from({ length: 61 }, (_, i) => ({
      id: `old${i}`,
      title: "Earlier task",
      due_date: new Date("2026-10-01"),
      status: "pending",
      points: 10,
      verified_notes: "Try again",
    }));
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(old);
    const result = (await DashboardPage()) as React.ReactElement;
    expect(findMany.mock.calls[1][0]).toMatchObject({
      where: {
        family_id: "home",
        assigned_to: "kid",
        status: { in: ["pending", "in_progress", "overdue"] },
      },
      take: 61,
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      family_id: "home",
      assigned_to: "kid",
    });
    expect(result.props.chores).toHaveLength(60);
    expect(result.props.workPreviewLimited).toBe(true);
    expect(result.props.chores[0]).not.toHaveProperty("points");
    expect(result.props.chores[0].verified_notes).toBe("Try again");
    expect(result.props.rewards).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});
