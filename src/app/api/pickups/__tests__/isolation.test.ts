// Two-household isolation for GET /api/pickups and /api/pickups/[id] (#102).
// POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import * as pickup from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";

describe("pickups — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    req({ as: null });
    expect((await GET()).status).toBe(401);
    expect((await pickup.PATCH(req({ body: { completed: true } }), params({ id: "pickup-a" }))).status).toBe(401);
    expect((await pickup.DELETE(req(), params({ id: "pickup-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    req({ as: "childA" });
    const body = await expectNoForeignData(await GET());
    expect(body.pickups.map((p: any) => p.id)).toEqual(["pickup-a"]);
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
});
