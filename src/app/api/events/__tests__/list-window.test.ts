// GET /api/events without `upcoming` returns a recent window (events ending no
// earlier than 30 days ago, oldest first), not the household's 100 oldest
// events ever. `upcoming=true` is unchanged.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import { db, req, FAMILY_A, FAMILY_B } from "@/__tests__/helpers/two-household";

const DAY = 24 * 60 * 60 * 1000;

function event(id: string, startOffsetDays: number, opts: { family_id?: string; lengthDays?: number } = {}) {
  const start = new Date(Date.now() + startOffsetDays * DAY);
  db.rows("event").push({
    id, family_id: opts.family_id ?? FAMILY_A, title: id, description: null, start_time: start,
    end_time: new Date(start.getTime() + (opts.lengthDays ?? 0) * DAY + 60 * 60 * 1000),
    location: null, event_type: "other", recurrence: null, created_by: "parent-a", project_id: null,
    is_task: false, created_at: start,
  });
}

async function list(query?: Record<string, string>) {
  const res = await GET(req({ as: "parentA", path: "/api/events", query }));
  expect(res.status).toBe(200);
  return (await res.json()).events.map((e: any) => e.id) as string[];
}

describe("GET /api/events — list window", () => {
  beforeEach(() => {
    db.reset();
    db.rows("event").length = 0;
  });

  it("leaves out old events even when the household has more than 100 of them", async () => {
    for (let i = 0; i < 120; i++) event(`old-${i}`, -400 + i);
    event("last-week", -7);
    event("today", 0);
    event("next-month", 30);
    event("foreign", 0, { family_id: FAMILY_B });

    expect(await list()).toEqual(["last-week", "today", "next-month"]);
  });

  it("keeps an ongoing event that started before the window", async () => {
    event("long-trip", -45, { lengthDays: 60 });
    event("ended-40-days-ago", -40);
    event("tomorrow", 1);

    expect(await list()).toEqual(["long-trip", "tomorrow"]);
  });

  it("upcoming=true still lists only events starting from now", async () => {
    event("yesterday", -1);
    event("tomorrow", 1);
    event("next-week", 7);

    expect(await list({ upcoming: "true" })).toEqual(["tomorrow", "next-week"]);
  });

  it("keeps a repeating event whose first occurrence ended long ago", async () => {
    event("weekly-old", -60);
    db.find("event", "weekly-old")!.recurrence = "FREQ=WEEKLY";
    event("one-off-old", -60);
    const ids = await list();
    expect(ids).toContain("weekly-old");
    expect(ids).not.toContain("one-off-old");
  });
});
