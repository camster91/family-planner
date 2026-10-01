// GET /api/analytics returns the members list and weekly completion the
// analytics page reads, with XP/level/streaks only when Points & streaks is on.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/gamification-visibility", () => ({ isGamificationOn: jest.fn() }));

import { GET } from "../route";
import { db, req, FAMILY_A } from "@/__tests__/helpers/two-household";
import { isGamificationOn } from "@/lib/gamification-visibility";

const NOW = new Date("2026-10-01T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function chore(id: string, over: Record<string, unknown>) {
  db.rows("chore").push({
    id, family_id: FAMILY_A, title: "Dishes", points: 10, assigned_to: "child-a",
    status: "pending", difficulty: "easy", completed_at: null, due_date: new Date(NOW.getTime() - DAY),
    created_by: "parent-a", created_at: new Date(NOW.getTime() - 2 * DAY), ...over,
  });
}

async function analytics() {
  const res = await GET(req({ as: "parentA", path: "/api/analytics", query: { tz: "UTC" } }));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/analytics — members and weekly completion", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "setTimeout", "setInterval"],
    });
    db.reset();
    db.rows("chore").length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it("counts chores due in the last 7 days for weeklyCompletion", async () => {
    (isGamificationOn as jest.Mock).mockResolvedValue(false);
    chore("a", { status: "verified", completed_at: new Date(NOW.getTime() - DAY) });
    chore("b", { status: "pending" });
    chore("old", { status: "pending", due_date: new Date(NOW.getTime() - 20 * DAY) });
    const { status, body } = await analytics();
    expect(status).toBe(200);
    expect(body.weeklyCompletion).toBe(50);
  });

  it("omits XP, level and streaks when Points & streaks is off", async () => {
    (isGamificationOn as jest.Mock).mockResolvedValue(false);
    chore("a", { status: "verified", completed_at: new Date(NOW.getTime() - DAY) });
    const { body } = await analytics();
    expect(body.gamification).toBe(false);
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThan(0);
    for (const m of body.members) {
      expect(m).not.toHaveProperty("xp");
      expect(m).not.toHaveProperty("level");
      expect(m).not.toHaveProperty("streak");
      expect(m).not.toHaveProperty("best_streak");
    }
    const child = body.members.find((m: { id: string }) => m.id === "child-a");
    expect(child).toMatchObject({ completedChores: 1, totalChores: 1 });
  });

  it("includes XP fields and sorts by XP when Points & streaks is on", async () => {
    (isGamificationOn as jest.Mock).mockResolvedValue(true);
    const { body } = await analytics();
    expect(body.gamification).toBe(true);
    for (const m of body.members) expect(m).toHaveProperty("xp");
    const xps = body.members.map((m: { xp: number }) => m.xp);
    expect([...xps].sort((a, b) => b - a)).toEqual(xps);
  });

  it("never lists another household's members", async () => {
    (isGamificationOn as jest.Mock).mockResolvedValue(true);
    const { body } = await analytics();
    expect(body.members.every((m: { id: string }) => !m.id.endsWith("-b"))).toBe(true);
  });
});
