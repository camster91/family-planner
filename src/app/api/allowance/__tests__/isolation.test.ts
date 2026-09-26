// Two-household + parent-only isolation for /api/allowance (#102).
// PATCH /api/allowance/[id] has its own test next to that route.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as allowance from "../route";
import { db, req, writesTo, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("allowance — two households; parents manage, kids read their own", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a session", async () => {
    req({ as: null });
    expect((await allowance.GET()).status).toBe(401);
    expect((await allowance.POST(req({ body: { to_user_id: "child-a", amount: 5 } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot create allowance", async (who) => {
    expect((await allowance.POST(req({ as: who, body: { to_user_id: who === "teenA" ? "teen-a" : "child-a", amount: 5 } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("D5: a child reads only their own allowance rows", async () => {
    db.rows("allowance").push({
      id: "allow-a-teen", family_id: "family-A", from_user_id: "parent-a", to_user_id: "teen-a",
      amount: 20, reason: "Teen weekly", status: "pending", scheduled_for: null, paid_at: null,
      created_at: new Date("2026-09-02T00:00:00Z"),
    });
    req({ as: "childA" });
    const res = await allowance.GET();
    expect(res.status).toBe(200);
    const body = await expectNoForeignData(res);
    expect(body.items.map((a: any) => a.id)).toEqual(["allow-a"]);
    expect(JSON.stringify(body)).not.toContain("Teen weekly");
  });

  it("D5: a teen reads only their own allowance rows (none for a sibling)", async () => {
    req({ as: "teenA" });
    const body = await expectNoForeignData(await allowance.GET());
    expect(body.items).toEqual([]);
  });

  it("D5: a family-B child never sees family A's rows", async () => {
    req({ as: "childB" });
    const body = await (await allowance.GET()).json();
    expect(body.items.map((a: any) => a.id)).toEqual(["allow-b"]);
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

  it("D6: a role change in the database applies on the next request (getServerUser re-reads it)", async () => {
    req({ as: "childA" });
    expect((await (await allowance.GET()).json()).items.map((a: any) => a.id)).toEqual(["allow-a"]);
    // Same session, member demoted/promoted out of band: the route follows the DB.
    db.find("user", "child-a")!.role = "parent";
    expect((await allowance.POST(req({ as: "childA", body: { to_user_id: "teen-a", amount: 1 } }))).status).toBe(201);
    db.find("user", "child-a")!.role = "child";
    expect((await allowance.POST(req({ as: "childA", body: { to_user_id: "teen-a", amount: 1 } }))).status).toBe(403);
  });
});
