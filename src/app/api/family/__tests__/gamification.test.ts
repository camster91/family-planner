// Points, streaks and the leaderboard as a family setting (#248).
//
// Route-level, on the two-household harness, with the REAL feature gate (no
// featureGate mock), so the stored Family.features blob decides:
//   * only a parent can toggle `gamification` (teen/child 403);
//   * a new family is created with gamification OFF, a legacy blob without
//     the key reads as ON;
//   * with it off, the leaderboard (analytics) and rewards endpoints 403 for
//     every role, and the profile / chores APIs omit XP, level, streak and
//     chore points; with it on they behave as before;
//   * chore completion and verify still work with it off, and XP keeps
//     accruing in the background.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/notifications-server", () => {
  const sendNotification = jest.fn(async () => undefined);
  return {
    notificationServiceServer: { sendNotification, notifyChoreAssignment: async () => undefined },
  };
});
jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  // The harness stores a placeholder hash; the login password check is not under test.
  safeVerifyPassword: async () => true,
}));

import * as features from "../features/route";
import { POST as createFamily } from "../route";
import { GET as analytics } from "../../analytics/route";
import * as rewards from "../../rewards/route";
import { POST as claim } from "../../rewards/claim/route";
import * as chores from "../../chores/route";
import { POST as completeChore } from "../../chores/complete/route";
import { POST as verifyChore } from "../../chores/verify/route";
import { GET as me } from "../../auth/me/route";
import { POST as login } from "../../auth/login/route";
import * as users from "../../users/route";
import { notificationServiceServer } from "@/lib/notifications-server";
import { defaultFeatures } from "@/lib/features";
import { db, req, writesTo, bodyOf, FAMILY_A, FAMILY_B, type UserKey } from "@/__tests__/helpers/two-household";

const GAMIFICATION_KEYS = ['"xp"', '"level"', '"streak"', '"best_streak"', '"last_chore_date"'];
const KIDS_AND_PARENT: UserKey[] = ["parentA", "teenA", "childA"];

function setGamification(familyId: string, on: boolean | undefined) {
  const family = db.find("family", familyId)!;
  family.features = on === undefined ? { meals: true } : { gamification: on };
}

function expectNoGamification(body: unknown) {
  const text = JSON.stringify(body);
  for (const key of GAMIFICATION_KEYS) expect(text).not.toContain(key);
}

describe("gamification setting (#248) — toggle", () => {
  beforeEach(() => db.reset());

  it("a parent can turn it off and on again; only their own family changes", async () => {
    setGamification(FAMILY_A, true);
    setGamification(FAMILY_B, true);

    const off = await features.PATCH(req({ as: "parentA", body: { key: "gamification", enabled: false } }));
    expect(off.status).toBe(200);
    expect((await bodyOf(off)).features.gamification).toBe(false);
    expect(db.find("family", FAMILY_A)!.features.gamification).toBe(false);
    expect(db.find("family", FAMILY_B)!.features).toEqual({ gamification: true });

    const on = await features.PATCH(req({ as: "parentA", body: { features: { gamification: true } } }));
    expect(on.status).toBe(200);
    expect(db.find("family", FAMILY_A)!.features.gamification).toBe(true);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s gets 403 and nothing is written", async (who) => {
    setGamification(FAMILY_A, true);
    for (const body of [{ key: "gamification", enabled: false }, { features: { gamification: false } }]) {
      const res = await features.PATCH(req({ as: who, body }));
      expect(res.status).toBe(403);
    }
    expect(writesTo("family")).toHaveLength(0);
    expect(db.find("family", FAMILY_A)!.features).toEqual({ gamification: true });
  });

  it("GET reports the flag to every role (so the UI can gate itself)", async () => {
    setGamification(FAMILY_A, false);
    for (const who of KIDS_AND_PARENT) {
      req({ as: who });
      expect((await bodyOf(await features.GET())).features.gamification).toBe(false);
    }
  });

  it("a legacy blob without the key reads as ON (existing household)", async () => {
    setGamification(FAMILY_A, undefined);
    req({ as: "parentA" });
    expect((await bodyOf(await features.GET())).features.gamification).toBe(true);
  });

  it("a newly created family starts with it OFF", async () => {
    const res = await createFamily(req({ as: "loner", body: { name: "Brand new" } }));
    expect(res.status).toBe(200);
    const created = writesTo("family").find((w) => w.op === "create")!;
    expect(created.args.data.features).toEqual(defaultFeatures());
    expect(created.args.data.features.gamification).toBe(false);
  });
});

describe("gamification setting (#248) — OFF", () => {
  beforeEach(() => {
    db.reset();
    setGamification(FAMILY_A, false);
    (notificationServiceServer.sendNotification as jest.Mock).mockClear();
  });

  it.each(KIDS_AND_PARENT.map((w) => [w]))("the leaderboard and rewards endpoints 403 for %s", async (who) => {
    expect((await analytics(req({ as: who as UserKey }))).status).toBe(403);
    expect((await rewards.GET(req({ as: who as UserKey }))).status).toBe(403);
    expect((await claim(req({ as: who as UserKey, body: { rewardId: "reward-a" } }))).status).toBe(403);
    expect(db.find("user", "child-a")!.xp).toBe(500);
    expect(db.find("reward", "reward-a")!.status).toBe("available");
  });

  it.each(KIDS_AND_PARENT.map((w) => [w]))("profile and chores APIs omit XP/level/streak/points for %s", async (who) => {
    const u = who as UserKey;
    const meBody = await bodyOf(await me(req({ as: u })));
    expect(meBody.user.name).toBeTruthy();
    expectNoGamification(meBody);

    const userBody = await bodyOf(await users.GET(req({ as: u })));
    expect(userBody.user.id).toBeTruthy();
    expectNoGamification(userBody);

    const choreBody = await bodyOf(await chores.GET(req({ as: u })));
    expect(choreBody.chores.length).toBeGreaterThan(0);
    for (const c of choreBody.chores) expect(c).not.toHaveProperty("points");
  });

  it("the login response omits XP/level/streak", async () => {
    const res = await login(req({ as: null, body: { email: "child-a@example.test", password: "irrelevant-pass" } }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.user.id).toBe("child-a");
    expectNoGamification(body);
  });

  it("chore completion still records the completion, and XP accrues in the background", async () => {
    const done = await completeChore(req({ as: "childA", body: { choreId: "chore-a" } }));
    expect(done.status).toBe(200);
    expect(db.find("chore", "chore-a")!.status).toBe("completed");
    expect(db.rows("activity").some((a) => a.type === "chore_completed" && a.family_id === FAMILY_A && a.user_id === "child-a")).toBe(true);

    const verified = await verifyChore(req({ as: "parentA", body: { choreId: "chore-a" } }));
    expect(verified.status).toBe(200);
    expect(db.find("chore", "chore-a")!.status).toBe("verified");
    // Background accrual: switching back on later is not a regression.
    expect(db.find("user", "child-a")!.xp).toBeGreaterThan(500);
    // No level-up message while points are off.
    const titles = (notificationServiceServer.sendNotification as jest.Mock).mock.calls.map((c: any[]) => c[0].title);
    expect(titles.some((t: string) => /level up/i.test(t))).toBe(false);
  });
});

describe("gamification setting (#248) — ON (existing households unchanged)", () => {
  beforeEach(() => {
    db.reset();
    setGamification(FAMILY_A, true);
  });

  it("analytics and rewards answer, and the APIs still carry XP and points", async () => {
    expect((await analytics(req({ as: "parentA" }))).status).toBe(200);
    expect((await rewards.GET(req({ as: "childA" }))).status).toBe(200);

    const meBody = await bodyOf(await me(req({ as: "childA" })));
    expect(meBody.user.xp).toBe(500);
    const userBody = await bodyOf(await users.GET(req({ as: "teenA" })));
    expect(userBody.user.level).toBe(1);
    const choreBody = await bodyOf(await chores.GET(req({ as: "parentA" })));
    expect(choreBody.chores[0].points).toBe(10);
  });

  it("verify still sends the level-up message", async () => {
    (notificationServiceServer.sendNotification as jest.Mock).mockClear();
    db.find("chore", "chore-a")!.status = "completed";
    expect((await verifyChore(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(200);
    const titles = (notificationServiceServer.sendNotification as jest.Mock).mock.calls.map((c: any[]) => c[0].title);
    expect(titles.some((t: string) => /level up/i.test(t))).toBe(true);
  });

  it("a legacy blob without the key behaves as ON", async () => {
    setGamification(FAMILY_A, undefined);
    expect((await analytics(req({ as: "parentA" }))).status).toBe(200);
    expect((await bodyOf(await me(req({ as: "childA" })))).user.xp).toBe(500);
  });

  it("Rewards turned off on its own still 403s even with points on", async () => {
    db.find("family", FAMILY_A)!.features = { gamification: true, rewards: false };
    expect((await rewards.GET(req({ as: "childA" }))).status).toBe(403);
    expect((await analytics(req({ as: "parentA" }))).status).toBe(200);
  });
});
