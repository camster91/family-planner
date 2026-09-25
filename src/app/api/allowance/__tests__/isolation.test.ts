// Two-household + parent-only isolation for /api/allowance (#102).
// PATCH /api/allowance/[id] has its own test next to that route.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as allowance from "../route";
import { db, req, writesTo, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("allowance — two households, parent only", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a session", async () => {
    req({ as: null });
    expect((await allowance.GET()).status).toBe(401);
    expect((await allowance.POST(req({ body: { to_user_id: "child-a", amount: 5 } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot read or create allowance", async (who) => {
    req({ as: who });
    const read = await allowance.GET();
    expect(read.status).toBe(403);
    expect(await read.json()).not.toHaveProperty("items");
    expect((await allowance.POST(req({ as: who, body: { to_user_id: who === "teenA" ? "teen-a" : "child-a", amount: 5 } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a parent lists only their own family", async () => {
    req({ as: "parentA" });
    const body = await expectNoForeignData(await allowance.GET());
    expect(body.items.map((a: any) => a.id)).toEqual(["allow-a"]);
  });

  it("rejects a family-B recipient", async () => {
    expect((await allowance.POST(req({ as: "parentA", body: { to_user_id: "child-b", amount: 5 } }))).status).toBe(400);
    expect(db.writes).toHaveLength(0);
  });

  it("a parent pays a same-family child", async () => {
    const res = await allowance.POST(req({ as: "parentA", body: { to_user_id: "child-a", amount: 5, family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("allowance")[0].args.data).toMatchObject({ family_id: "family-A", from_user_id: "parent-a" });
  });
});
