// Two-household + parent-only isolation for /api/locations (#102). Saved
// places carry precise addresses, which are parent-only.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as locations from "../route";
import * as location from "../[id]/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("locations — two households, parent only", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await locations.GET(req({ as: null }))).status).toBe(401);
    expect((await locations.POST(req({ body: { label: "Gym" } }))).status).toBe(401);
    expect((await location.PATCH(req({ body: { label: "Gym" } }), params({ id: "loc-a" }))).status).toBe(401);
    expect((await location.DELETE(req(), params({ id: "loc-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot read, add, edit or delete addresses", async (who) => {
    req({ as: who });
    const read = await locations.GET(req({ as: who }));
    expect(read.status).toBe(403);
    expect(JSON.stringify(await read.json())).not.toContain("Street");
    expect((await locations.POST(req({ as: who, body: { label: "Gym" } }))).status).toBe(403);
    expect((await location.PATCH(req({ as: who, body: { label: "Gym" } }), params({ id: "loc-a" }))).status).toBe(403);
    expect((await location.DELETE(req({ as: who }), params({ id: "loc-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a parent lists only their own family's places", async () => {
    req({ as: "parentA" });
    const response = await locations.GET(req({ as: "parentA" }));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await expectNoForeignData(response);
    expect(body.locations.map((l: any) => l.id)).toEqual(["loc-a"]);
    expect(body.locations[0]).not.toHaveProperty("family_id");
    expect(body.locations[0]).not.toHaveProperty("latitude");
    expect(body.locations[0]).not.toHaveProperty("created_at");
  });

  it("a parent cannot delete another family's place", async () => {
    await expectDenied(await location.DELETE(req({ as: "parentA" }), params({ id: "loc-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("a parent cannot edit another family's place", async () => {
    await expectDenied(await location.PATCH(req({ as: "parentA", body: { label: "Foreign edit" } }), params({ id: "loc-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("a parent updates only their own family place", async () => {
    const res = await location.PATCH(
      req({ as: "parentA", body: { label: "School", address: "2 Main" } }),
      params({ id: "loc-a" }),
    );
    expect(res.status).toBe(200);
    expect(writesTo("familyLocation")[0].args).toMatchObject({
      where: { id: "loc-a", family_id: "family-A" },
      data: { label: "School", address: "2 Main", is_primary: false },
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.location).toMatchObject({ id: "loc-a", label: "School", address: "2 Main" });
    expect(body.location).not.toHaveProperty("family_id");
  });

  it("rejects an invalid edit without writing", async () => {
    const res = await location.PATCH(req({ as: "parentA", body: { label: "" } }), params({ id: "loc-a" }));
    expect(res.status).toBe(400);
    expect(db.writes).toHaveLength(0);
  });

  it("a parent creates in their own family", async () => {
    const res = await locations.POST(req({ as: "parentA", body: { label: "Gym", address: "2 Main", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.location).toMatchObject({ label: "Gym", address: "2 Main", user_id: "parent-a" });
    expect(body.location).not.toHaveProperty("family_id");
    expect(writesTo("familyLocation")[0].args.data).toMatchObject({ family_id: "family-A", user_id: "parent-a" });
    expect((await location.DELETE(req({ as: "parentA" }), params({ id: "loc-a" }))).status).toBe(200);
  });
});
