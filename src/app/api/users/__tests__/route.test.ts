// Account-scoped /api/users (#102): every handler acts on the session's own
// user only; there is no way to address another user by id.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import * as users from "../route";
import { db, req, writesTo, expectNoForeignData } from "@/__tests__/helpers/two-household";

describe("/api/users — own account only", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a session", async () => {
    expect((await users.GET(req())).status).toBe(401);
    expect((await users.PATCH(req({ body: { name: "x" } }))).status).toBe(401);
    expect((await users.DELETE(req())).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("GET returns the caller's own safe profile", async () => {
    const body = await expectNoForeignData(await users.GET(req({ as: "childA" })));
    expect(body.user.id).toBe("child-a");
    expect(body.user).not.toHaveProperty("password");
    expect(body.user).not.toHaveProperty("token_version");
  });

  it("PATCH ignores smuggled id/family_id/role and updates only the caller", async () => {
    const res = await users.PATCH(
      req({ as: "childA", body: { name: "Kid", id: "parent-b", family_id: "family-B", role: "parent" } })
    );
    expect(res.status).toBe(200);
    const [write] = writesTo("user");
    expect(write.args.where).toEqual({ id: "child-a" });
    expect(Object.keys(write.args.data)).toEqual(["name"]);
    expect(db.find("user", "child-a")).toMatchObject({ role: "child", family_id: "family-A" });
  });

  it("DELETE refuses to remove the only parent, and never touches another user", async () => {
    expect((await users.DELETE(req({ as: "parentA" }))).status).toBe(400);
    expect((await users.DELETE(req({ as: "childA" }))).status).toBe(200);
    expect(writesTo("user")).toEqual([expect.objectContaining({ op: "delete", args: { where: { id: "child-a" } } })]);
  });
});
