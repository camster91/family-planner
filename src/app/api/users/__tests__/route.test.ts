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
    // Full deletion behaviour: deletion.test.ts and src/lib/__tests__/account-deletion.test.ts.
    const bcrypt = require("bcryptjs");
    for (const id of ["parent-a", "child-a"]) db.find("user", id)!.password = bcrypt.hashSync("pw-123456", 4);
    const del = (as: "parentA" | "childA") =>
      users.DELETE(req({ as, method: "DELETE", body: { password: "pw-123456", confirmation: "DELETE" } }));
    const last = await del("parentA");
    expect(last.status).toBe(409);
    expect((await last.json()).code).toBe("LAST_PARENT");
    expect(db.writes.filter((w) => w.model !== "rateLimitEntry")).toHaveLength(0);
    expect((await del("childA")).status).toBe(200);
    const userWrites = writesTo("user");
    expect(userWrites.map((w) => w.args.where)).toEqual([{ id: "child-a" }, { id: "child-a" }]);
    expect(db.find("user", "parent-b")).toBeDefined();
  });
});
