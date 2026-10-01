// GET /api/analytics counts days in the viewer's local zone (O-31) and only
// chores that are due (or done) inside the 90-day window.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import { db, req, FAMILY_A, FAMILY_B } from "@/__tests__/helpers/two-household";

// 11:00 in Toronto (EDT, UTC-4) on Thursday 1 October 2026.
const NOW = new Date("2026-10-01T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
function chore(over: Record<string, unknown>) {
  seq += 1;
  db.rows("chore").push({
    id: `c-${seq}`, family_id: FAMILY_A, title: "Dishes", points: 10, assigned_to: "child-a",
    status: "pending", difficulty: "easy", completed_at: null, due_date: new Date(NOW.getTime() - DAY),
    created_by: "parent-a", created_at: new Date(NOW.getTime() - 2 * DAY), ...over,
  });
}

async function analytics(query?: Record<string, string>) {
  const res = await GET(req({ as: "parentA", path: "/api/analytics", query }));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/analytics — local days and bounded window", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "setTimeout", "setInterval"],
    });
    db.reset();
    db.rows("chore").length = 0;
    seq = 0;
    // Tuesday 29 Sep at 21:00 Toronto (already Wednesday 30 Sep in UTC) and
    // Wednesday 30 Sep at 09:00 Toronto.
    chore({ status: "completed", completed_at: new Date("2026-09-30T01:00:00Z") });
    chore({ status: "verified", completed_at: new Date("2026-09-30T13:00:00Z"), points: 5 });
  });
  afterEach(() => jest.useRealTimers());

  it("groups an evening completion on the viewer's local day, not the next UTC day", async () => {
    const { status, body } = await analytics({ tz: "America/Toronto" });
    expect(status).toBe(200);
    const week = Object.fromEntries(body.weeklyTrend.map((d: any) => [d.date, d]));
    expect(body.weeklyTrend).toHaveLength(7);
    expect(body.weeklyTrend[6]).toMatchObject({ date: "2026-10-01", day: "Thu", count: 0 });
    expect(week["2026-09-29"]).toMatchObject({ day: "Tue", count: 1, points: 10 });
    expect(week["2026-09-30"]).toMatchObject({ day: "Wed", count: 1, points: 5 });
    // Two consecutive local days, ending yesterday: the streak does not break.
    expect(body.summary.currentStreak).toBe(2);
    expect(["Tuesday", "Wednesday"]).toContain(body.summary.mostActiveDay.day);
  });

  it("tzOffset (getTimezoneOffset minutes) gives the same local days", async () => {
    const { body } = await analytics({ tzOffset: "240" });
    const week = Object.fromEntries(body.weeklyTrend.map((d: any) => [d.date, d.count]));
    expect(week["2026-09-29"]).toBe(1);
    expect(week["2026-09-30"]).toBe(1);
    expect(body.summary.currentStreak).toBe(2);
  });

  it("without a zone it keeps UTC days (older clients)", async () => {
    const { body } = await analytics();
    const week = Object.fromEntries(body.weeklyTrend.map((d: any) => [d.date, d.count]));
    expect(week["2026-09-30"]).toBe(2);
    expect(week["2026-09-29"]).toBe(0);
    expect(body.summary.currentStreak).toBe(1);
  });

  it.each<Record<string, string>>([{ tz: "Mars/Olympus" }, { tz: "x".repeat(100) }, { tzOffset: "abc" }, { tzOffset: "5000" }])(
    "rejects an invalid zone %p with 400",
    async (query) => {
      const { status } = await analytics(query);
      expect(status).toBe(400);
    },
  );

  it("leaves future occurrences and chores older than 90 days out of the completion rate", async () => {
    chore({ due_date: new Date(NOW.getTime() + 2 * DAY) }); // generated ahead, not due yet
    chore({ due_date: new Date(NOW.getTime() + 7 * DAY) });
    chore({ due_date: new Date(NOW.getTime() - 200 * DAY) }); // outside the window
    chore({ due_date: new Date(NOW.getTime() - 3 * DAY) }); // due and missed: counts
    // Done early although due next week: counts on both sides.
    chore({ due_date: new Date(NOW.getTime() + 5 * DAY), status: "completed", completed_at: new Date(NOW.getTime() - DAY) });
    // Another household's chore never counts.
    chore({ family_id: FAMILY_B, assigned_to: "child-b", due_date: new Date(NOW.getTime() - DAY) });

    const { body } = await analytics({ tz: "America/Toronto" });
    expect(body.summary.totalChores).toBe(4);
    expect(body.summary.completedChores).toBe(3);
    expect(body.summary.completionRate).toBe(75);
    const child = body.memberParticipation.find((m: any) => m.id === "child-a");
    expect(child).toMatchObject({ totalChores: 4, completedChores: 3, completionRate: 75 });
  });
});
