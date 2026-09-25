// Two-household isolation for /api/rewards, /claim and /approve (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/notifications-server", () => require("@/__tests__/helpers/two-household").notificationsMock);

import * as rewards from "../route";
import { POST as claim } from "../claim/route";
import { POST as approve } from "../approve/route";
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("rewards — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await rewards.GET(req())).status,
      (await rewards.POST(req({ body: { name: "x", cost: 5 } }))).status,
      (await rewards.PATCH(req({ body: { rewardId: "reward-a", cost: 1 } }))).status,
      (await claim(req({ body: { rewardId: "reward-a" } }))).status,
      (await approve(req({ body: { rewardId: "reward-a" } }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await rewards.GET(req({ as: "childA" })));
    expect(body.rewards.map((r: any) => r.id)).toEqual(["reward-a"]);
  });

  it("refuses to update, claim or approve another family's reward", async () => {
    await expectDenied(await rewards.PATCH(req({ as: "parentA", body: { rewardId: "reward-b", cost: 1 } })));
    await expectDenied(await claim(req({ as: "childA", body: { rewardId: "reward-b" } })));
    db.find("reward", "reward-b")!.status = "claimed";
    await expectDenied(await approve(req({ as: "parentA", body: { rewardId: "reward-b" } })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("user", "child-a")?.xp).toBe(500);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot create, edit or approve rewards", async (who) => {
    expect((await rewards.POST(req({ as: who, body: { name: "x", cost: 5 } }))).status).toBe(403);
    expect((await rewards.PATCH(req({ as: who, body: { rewardId: "reward-a", cost: 1 } }))).status).toBe(403);
    db.find("reward", "reward-a")!.status = "claimed";
    expect((await approve(req({ as: who, body: { rewardId: "reward-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a child claims and a parent approves a same-family reward", async () => {
    expect((await claim(req({ as: "childA", body: { rewardId: "reward-a" } }))).status).toBe(200);
    expect(db.find("reward", "reward-a")).toMatchObject({ status: "claimed", claimed_by: "child-a" });
    expect(db.find("user", "child-a")?.xp).toBe(490);
    expect((await approve(req({ as: "parentA", body: { rewardId: "reward-a" } }))).status).toBe(200);
    expect(db.find("reward", "reward-a")?.status).toBe("redeemed");
    const created = await rewards.POST(req({ as: "parentA", body: { name: "Movie", cost: 20, family_id: "family-B" } }));
    expect(created.status).toBe(200);
    expect(writesTo("reward").find((w) => w.op === "create")?.args.data).toMatchObject({ family_id: "family-A" });
  });
});
