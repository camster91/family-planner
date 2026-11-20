// Two-household isolation for GET /api/pickups and /api/pickups/[id] (#102).
// POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET, POST } from "../route";
import * as pickup from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("pickups — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    req({ as: null });
    expect((await GET(req({ as: null }))).status).toBe(401);
    expect((await pickup.PATCH(req({ body: { completed: true } }), params({ id: "pickup-a" }))).status).toBe(401);
    expect((await pickup.DELETE(req(), params({ id: "pickup-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    req({ as: "childA" });
    const body = await expectNoForeignData(await GET(req({ as: "childA" })));
    expect(body.pickups.map((p: any) => p.id)).toEqual(["pickup-a"]);
    // Children read only (owner decision 2026-11-19); the page hides writes.
    expect(body.can_write).toBe(false);
    const parent = await (await GET(req({ as: "parentA" }))).json();
    expect(parent.can_write).toBe(true);
  });

  it("refuses to complete or delete another family's pickup", async () => {
    await expectDenied(await pickup.PATCH(req({ as: "parentA", body: { completed: true } }), params({ id: "pickup-b" })));
    await expectDenied(await pickup.DELETE(req({ as: "parentA" }), params({ id: "pickup-b" })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("pickup", "pickup-b")?.completed).toBe(false);
  });

  it("a same-family member can complete a pickup", async () => {
    expect((await pickup.PATCH(req({ as: "parentA", body: { completed: true } }), params({ id: "pickup-a" }))).status).toBe(200);
    expect(db.find("pickup", "pickup-a")?.completed).toBe(true);
  });

  it.each<[UserKey]>([["teenA"]])("D9: %s can create and complete but not delete a pickup", async (who) => {
    const created = await POST(req({ as: who, body: { title: "Library pickup", pickup_time: "2030-10-16T15:00:00.000Z" } }));
    expect(created.status).toBe(201);
    const body = await expectNoForeignData(created);
    expect(body.pickup.family_id).toBe(db.find("pickup", "pickup-a")?.family_id);
    expect((await pickup.PATCH(req({ as: who, body: { completed: true } }), params({ id: "pickup-a" }))).status).toBe(200);
    expect((await pickup.DELETE(req({ as: who }), params({ id: "pickup-a" }))).status).toBe(403);
    expect(db.find("pickup", "pickup-a")).toBeDefined();
  });

  it("owner decision 2026-11-19: a child reads pickups but cannot create, complete or delete one", async () => {
    expect((await POST(req({ as: "childA", body: { title: "Library pickup", pickup_time: "2030-10-16T15:00:00.000Z" } }))).status).toBe(403);
    expect((await pickup.PATCH(req({ as: "childA", body: { completed: true } }), params({ id: "pickup-a" }))).status).toBe(403);
    expect((await pickup.DELETE(req({ as: "childA" }), params({ id: "pickup-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
    expect(db.find("pickup", "pickup-a")?.completed).toBe(false);
  });

  it("owner decision 2026-11-19: a family-B child cannot complete family A's pickup, and learns nothing about it", async () => {
    await expectDenied(await pickup.PATCH(req({ as: "childB", body: { completed: true } }), params({ id: "pickup-a" })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("pickup", "pickup-a")?.completed).toBe(false);
  });

  it("D9: a parent can delete their own family's pickup", async () => {
    expect((await pickup.DELETE(req({ as: "parentA" }), params({ id: "pickup-a" }))).status).toBe(200);
    expect(db.find("pickup", "pickup-a")).toBeUndefined();
  });

  it("D9: a family-B child is denied family A's pickup without leaking it", async () => {
    await expectDenied(await pickup.DELETE(req({ as: "childB" }), params({ id: "pickup-a" })));
    expect(db.find("pickup", "pickup-a")).toBeDefined();
  });
});
