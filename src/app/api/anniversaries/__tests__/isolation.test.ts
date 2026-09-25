// Two-household isolation for /api/anniversaries and /api/anniversaries/[id] (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[id]/route";
import { db, req, writesTo, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";

const newDate = { name: "Gran", type: "birthday", date: "2026-12-01" };

describe("anniversaries — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req({ body: newDate }))).status).toBe(401);
    expect((await PATCH(req({ body: { id: "ann-a", name: "x" } }))).status).toBe(401);
    expect((await DELETE(req({ query: { id: "ann-a" } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const res = await GET(req({ as: "childA" }));
    expect(res.status).toBe(200);
    const body = await expectNoForeignData(res);
    expect(body.dates.map((d: any) => d.id)).toEqual(["ann-a"]);
  });

  it("refuses to update or delete another family's anniversary", async () => {
    await expectDenied(await PATCH(req({ as: "parentA", body: { id: "ann-b", name: "hijack" } })));
    await expectDenied(await DELETE(req({ as: "parentA", query: { id: "ann-b" } })));
    expect(db.find("anniversary", "ann-b")?.name).toContain("FOREIGN");
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it("rejects a family-B person_id on create and update", async () => {
    const created = await POST(req({ as: "parentA", body: { ...newDate, person_id: "child-b" } }));
    expect(created.status).toBe(400);
    const updated = await PATCH(req({ as: "parentA", body: { id: "ann-a", person_id: "child-b" } }));
    expect(updated.status).toBe(400);
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it("creates for the caller's family even if a family_id is smuggled in", async () => {
    const res = await POST(req({ as: "parentA", body: { ...newDate, person_id: "child-a", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("anniversary")[0].args.data).toMatchObject({ family_id: "family-A", person_id: "child-a" });
  });

  it("lets a same-family member update and delete", async () => {
    expect((await PATCH(req({ as: "parentA", body: { id: "ann-a", name: "Renamed", person_id: "teen-a" } }))).status).toBe(200);
    expect(db.find("anniversary", "ann-a")).toMatchObject({ name: "Renamed", person_id: "teen-a" });
    expect((await DELETE(req({ as: "parentA", query: { id: "ann-a" } }))).status).toBe(200);
    expect(db.find("anniversary", "ann-a")).toBeUndefined();
  });
});
