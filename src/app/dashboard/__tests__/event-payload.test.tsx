import * as React from "react";
import DashboardPage from "../page";

const mockChoreFindMany = jest.fn();
const mockEventFindMany = jest.fn();
const mockRewardFindMany = jest.fn();
let mockRole: "child" | "teen" = "teen";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({
        id: "kid",
        name: "Casey",
        role: mockRole,
        family_id: "home",
        avatar_url: null,
        xp: 20,
        level: 1,
        family: { features: { gamification: false, rewards: false } },
      })),
    },
    chore: { findMany: (...args: unknown[]) => mockChoreFindMany(...args) },
    event: { findMany: (...args: unknown[]) => mockEventFindMany(...args) },
    reward: { findMany: (...args: unknown[]) => mockRewardFindMany(...args) },
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

const eventStart = new Date("2026-10-12T18:00:00.000Z");

describe("/dashboard child and teen event presentation", () => {
  beforeEach(() => {
    mockRole = "teen";
    mockChoreFindMany.mockReset();
    mockEventFindMany.mockReset();
    mockRewardFindMany.mockReset();
    mockChoreFindMany.mockResolvedValue([]);
    mockRewardFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([
      {
        id: "event-1",
        title: "School concert",
        start_time: eventStart,
        location: "Town hall",
        description: "EXTRA_EVENT_DESCRIPTION_SENTINEL",
        family_id: "home",
        created_by: "creator-secret",
        project_id: "project-secret",
        recurrence: "RRULE:FREQ=WEEKLY",
        source_connection_id: "provider-secret",
      },
    ]);
  });

  it.each(["child", "teen"] as const)(
    "passes only the event summary fields to the %s KidHome",
    async (role) => {
      mockRole = role;

      const result = (await DashboardPage()) as React.ReactElement<{
        events: Array<Record<string, unknown>>;
      }>;
      const props = result.props;
      expect(props.events).toEqual([
        {
          id: "event-1",
          title: "School concert",
          start_time: eventStart.toISOString(),
          location: "Town hall",
        },
      ]);
      expect(JSON.stringify(props.events)).not.toContain(
        "EXTRA_EVENT_DESCRIPTION_SENTINEL",
      );
      expect(JSON.stringify(props.events)).not.toContain("provider-secret");

      expect(mockEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            family_id: "home",
            start_time: { gte: expect.any(Date) },
          },
          select: {
            id: true,
            title: true,
            start_time: true,
            location: true,
          },
        }),
      );
    },
  );
});
