// Two-household isolation for /api/messages (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as messages from "../route";
import { db, req, writesTo, expectNoForeignData } from "@/__tests__/helpers/two-household";

describe("messages — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await messages.GET(req())).status).toBe(401);
    expect((await messages.POST(req({ body: { content: "hi" } }))).status).toBe(401);
    expect((await messages.PATCH(req({ body: { markAll: true } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family messages and members", async () => {
    const body = await expectNoForeignData(await messages.GET(req({ as: "childA" })));
    expect(body.messages.map((m: any) => m.id)).toEqual(["msg-a"]);
    expect(body.members.map((m: any) => m.id).sort()).toEqual(["child-a", "parent-a", "teen-a"]);
  });

  it("cannot mark another family's message as read", async () => {
    const res = await messages.PATCH(req({ as: "parentA", body: { messageIds: ["msg-b"] } }));
    expect(res.status).toBe(200);
    expect(db.find("message", "msg-b")?.read_by).toEqual([]);
  });

  it("markAll only touches the caller's family", async () => {
    await messages.PATCH(req({ as: "parentA", body: { markAll: true } }));
    expect(db.find("message", "msg-a")?.read_by).toEqual(["parent-a"]);
    expect(db.find("message", "msg-b")?.read_by).toEqual([]);
  });

  it("sends into the caller's family", async () => {
    const res = await messages.POST(req({ as: "childA", body: { content: "hi", family_id: "family-B" } }));
    expect(res.status).toBe(200);
    expect(writesTo("message")[0].args.data).toMatchObject({ family_id: "family-A", sender_id: "child-a" });
  });
});
