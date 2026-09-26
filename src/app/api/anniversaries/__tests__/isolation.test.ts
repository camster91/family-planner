// Two-household isolation for /api/anniversaries and /api/anniversaries/[id] (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[id]/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newDate = { name: "Gran", type: "birthday", date: "2026-12-01" };

describe("anniversaries — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req({ body: newDate }))).status).toBe(401);
    expect((await PATCH(req({ body: { name: "x" } }), params({ id: "ann-a" }))).status).toBe(401);
    expect((await DELETE(req(), params({ id: "ann-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const res = await GET(req({ as: "childA" }));
    expect(res.status).toBe(200);
    const body = await expectNoForeignData(res);
    expect(body.dates.map((d: any) => d.id)).toEqual(["ann-a"]);
  });

  it("refuses to update or delete another family's anniversary", async () => {
    await expectDenied(await PATCH(req({ as: "parentA", body: { name: "hijack" } }), params({ id: "ann-b" })));
    await expectDenied(await DELETE(req({ as: "parentA" }), params({ id: "ann-b" })));
    expect(db.find("anniversary", "ann-b")?.name).toContain("FOREIGN");
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it("rejects a family-B person_id on create and update", async () => {
    const created = await POST(req({ as: "parentA", body: { ...newDate, person_id: "child-b" } }));
    expect(created.status).toBe(400);
    const updated = await PATCH(req({ as: "parentA", body: { person_id: "child-b" } }), params({ id: "ann-a" }));
    expect(updated.status).toBe(400);
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it("creates for the caller's family even if a family_id is smuggled in", async () => {
    const res = await POST(req({ as: "parentA", body: { ...newDate, person_id: "child-a", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("anniversary")[0].args.data).toMatchObject({ family_id: "family-A", person_id: "child-a" });
  });

  it("D9: records the creator on create, and a smuggled created_by is ignored", async () => {
    const res = await POST(req({ as: "teenA", body: { ...newDate, created_by: "parent-a" } }));
    expect(res.status).toBe(201);
    expect(writesTo("anniversary")[0].args.data).toMatchObject({ family_id: "family-A", created_by: "teen-a" });
  });

  it("lets a same-family member update and delete", async () => {
    expect((await PATCH(req({ as: "parentA", body: { name: "Renamed", person_id: "teen-a" } }), params({ id: "ann-a" }))).status).toBe(200);
    expect(db.find("anniversary", "ann-a")).toMatchObject({ name: "Renamed", person_id: "teen-a" });
    expect((await DELETE(req({ as: "parentA" }), params({ id: "ann-a" }))).status).toBe(200);
    expect(db.find("anniversary", "ann-a")).toBeUndefined();
  });

  it("takes the id from the path, ignoring any id in the body", async () => {
    // Own-family path id, foreign id smuggled in the body: only ann-a changes.
    const res = await PATCH(req({ as: "parentA", body: { id: "ann-b", name: "Renamed" } }), params({ id: "ann-a" }));
    expect(res.status).toBe(200);
    expect(db.find("anniversary", "ann-a")?.name).toBe("Renamed");
    expect(db.find("anniversary", "ann-b")?.name).toContain("FOREIGN");
    // Foreign path id with own-family id in the body is still denied.
    await expectDenied(await PATCH(req({ as: "parentA", body: { id: "ann-a", name: "hijack" } }), params({ id: "ann-b" })));
    expect(db.find("anniversary", "ann-b")?.name).toContain("FOREIGN");
  });

  it("ignores a query-string id on delete (path id is authoritative)", async () => {
    await expectDenied(await DELETE(req({ as: "parentA", query: { id: "ann-a" } }), params({ id: "ann-b" })));
    expect(db.find("anniversary", "ann-a")).toBeDefined();
    expect(db.find("anniversary", "ann-b")).toBeDefined();
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s can create an anniversary in their own family", async (who) => {
    const res = await POST(req({ as: who, body: { ...newDate, family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("anniversary")[0].args.data).toMatchObject({ family_id: "family-A" });
  });

  // Legacy rows (created_by NULL, created before the column existed) cannot
  // prove ownership, so they stay parent-edit-only (docs/ROLE_AND_ISOLATION_MATRIX.md).
  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s cannot edit or delete a legacy anniversary", async (who) => {
    expect(db.find("anniversary", "ann-a")?.created_by).toBeNull();
    expect((await PATCH(req({ as: who, body: { name: "x" } }), params({ id: "ann-a" }))).status).toBe(403);
    expect((await DELETE(req({ as: who }), params({ id: "ann-a" }))).status).toBe(403);
    expect(db.find("anniversary", "ann-a")?.name).toBe("Home birthday");
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s edits an anniversary they created, but cannot delete it", async (who) => {
    const created = await POST(req({ as: who, body: newDate }));
    expect(created.status).toBe(201);
    const id = (await created.json()).date.id;

    const res = await PATCH(req({ as: who, body: { name: "Gran (Mum's side)", created_by: "parent-a" } }), params({ id }));
    expect(res.status).toBe(200);
    // created_by is not writable through PATCH.
    expect(db.find("anniversary", id)).toMatchObject({ name: "Gran (Mum's side)", created_by: `${who === "teenA" ? "teen" : "child"}-a` });

    expect((await DELETE(req({ as: who }), params({ id }))).status).toBe(403);
    expect(db.find("anniversary", id)).toBeDefined();
  });

  it("D9: a teen cannot edit an anniversary a sibling or parent created", async () => {
    db.rows("anniversary").push(
      { id: "ann-child", family_id: "family-A", name: "Child's date", type: "custom", date: new Date(), notes: null, person_id: null, created_by: "child-a", created_at: new Date() },
      { id: "ann-parent", family_id: "family-A", name: "Parent's date", type: "custom", date: new Date(), notes: null, person_id: null, created_by: "parent-a", created_at: new Date() },
    );
    expect((await PATCH(req({ as: "teenA", body: { name: "x" } }), params({ id: "ann-child" }))).status).toBe(403);
    expect((await PATCH(req({ as: "teenA", body: { name: "x" } }), params({ id: "ann-parent" }))).status).toBe(403);
    expect(writesTo("anniversary")).toHaveLength(0);
    // A parent still edits and deletes any household row, including a kid's.
    expect((await PATCH(req({ as: "parentA", body: { name: "Fixed" } }), params({ id: "ann-child" }))).status).toBe(200);
    expect((await DELETE(req({ as: "parentA" }), params({ id: "ann-child" }))).status).toBe(200);
  });

  it("D9: a created_by pointing at a family-B child grants that child nothing in family A", async () => {
    db.find("anniversary", "ann-a")!.created_by = "child-b"; // nonsensical, but must not grant access
    await expectDenied(await PATCH(req({ as: "childB", body: { name: "x" } }), params({ id: "ann-a" })));
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it("D9: a family-B child is denied family A's anniversary without leaking it", async () => {
    await expectDenied(await PATCH(req({ as: "childB", body: { name: "x" } }), params({ id: "ann-a" })));
    await expectDenied(await DELETE(req({ as: "childB" }), params({ id: "ann-a" })));
    expect(db.writes).toHaveLength(0);
  });
});
