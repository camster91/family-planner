// Two-household + role isolation for /api/handoff, /api/handoff/[id] and
// /api/handoff/[id]/regenerate-token (#102). The public share view has its own
// test under share/[token].

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as handoffs from "../route";
import * as handoff from "../[id]/route";
import { POST as regenerate } from "../[id]/regenerate-token/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("handoff — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await handoffs.GET(req())).status,
      (await handoffs.POST(req({ body: { sitter_name: "Sam" } }))).status,
      (await handoff.PATCH(req({ body: { sitter_name: "x" } }), params({ id: "handoff-a" }))).status,
      (await handoff.DELETE(req(), params({ id: "handoff-a" }))).status,
      (await regenerate(req(), params({ id: "handoff-a" }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await handoffs.GET(req({ as: "parentA" })));
    expect(body.handoffs.map((h: any) => h.id)).toEqual(["handoff-a"]);
    expect(body.handoffs[0].share_token).toBe("share-token-a");
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s never receives the share token", async (who) => {
    const res = await handoffs.GET(req({ as: who }));
    expect(res.status).toBe(200);
    const body = await expectNoForeignData(res);
    expect(body.handoffs).toHaveLength(1);
    expect(body.handoffs[0]).not.toHaveProperty("share_token");
    expect(body.handoffs[0]).not.toHaveProperty("share_expires_at");
    expect(JSON.stringify(body)).not.toContain("share-token-a");
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot create, edit, delete or rotate", async (who) => {
    expect((await handoffs.POST(req({ as: who, body: { sitter_name: "Sam" } }))).status).toBe(403);
    expect((await handoff.PATCH(req({ as: who, body: { sitter_name: "x" } }), params({ id: "handoff-a" }))).status).toBe(403);
    expect((await handoff.DELETE(req({ as: who }), params({ id: "handoff-a" }))).status).toBe(403);
    expect((await regenerate(req({ as: who }), params({ id: "handoff-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a parent cannot edit, delete or rotate another family's handoff", async () => {
    await expectDenied(await handoff.PATCH(req({ as: "parentA", body: { sitter_name: "x" } }), params({ id: "handoff-b" })));
    await expectDenied(await handoff.DELETE(req({ as: "parentA" }), params({ id: "handoff-b" })));
    await expectDenied(await regenerate(req({ as: "parentA" }), params({ id: "handoff-b" })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("handoff", "handoff-b")?.share_token).toBe("share-token-b");
  });

  it("a parent creates in their own family and rotates their own token", async () => {
    const res = await handoffs.POST(req({ as: "parentA", body: { sitter_name: "Sam", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("handoff")[0].args.data).toMatchObject({ family_id: "family-A" });
    expect((await regenerate(req({ as: "parentA" }), params({ id: "handoff-a" }))).status).toBe(200);
    expect(db.find("handoff", "handoff-a")?.share_token).not.toBe("share-token-a");
  });
});
