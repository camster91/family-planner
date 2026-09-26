// Two-household isolation for GET /api/medications and /api/medications/[id]
// (#102). POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import * as medication from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("medications — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    req({ as: null });
    expect((await GET()).status).toBe(401);
    expect((await medication.PATCH(req({ body: { markDoseTaken: true } }), params({ id: "med-a" }))).status).toBe(401);
    expect((await medication.DELETE(req(), params({ id: "med-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    req({ as: "parentA" });
    const body = await expectNoForeignData(await GET());
    expect(body.medications.map((m: any) => m.id)).toEqual(["med-a"]);
  });

  it("refuses to update or delete another family's medication", async () => {
    await expectDenied(await medication.PATCH(req({ as: "parentA", body: { markDoseTaken: true } }), params({ id: "med-b" })));
    await expectDenied(await medication.DELETE(req({ as: "parentA" }), params({ id: "med-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("a child may only log a dose: edits to the prescription are ignored and delete is 403", async () => {
    const res = await medication.PATCH(
      req({ as: "childA", body: { markDoseTaken: true, dosage: "50ml", name: "x" } }),
      params({ id: "med-a" })
    );
    expect(res.status).toBe(200);
    expect(db.find("medication", "med-a")).toMatchObject({ dosage: "5ml", name: "Home syrup" });
    expect(db.find("medication", "med-a")?.last_dose_at).toBeInstanceOf(Date);
    expect((await medication.DELETE(req({ as: "childA" }), params({ id: "med-a" }))).status).toBe(403);
  });

  it("a parent can edit and delete their own family's medication", async () => {
    expect((await medication.PATCH(req({ as: "parentA", body: { dosage: "10ml" } }), params({ id: "med-a" }))).status).toBe(200);
    expect(db.find("medication", "med-a")?.dosage).toBe("10ml");
    expect((await medication.DELETE(req({ as: "parentA" }), params({ id: "med-a" }))).status).toBe(200);
  });

  describe("D1: teen/child see and dose only their own medications", () => {
    beforeEach(() => {
      db.rows("medication").push({
        id: "med-a-teen", family_id: "family-A", sick_day_id: null, person_id: "teen-a",
        name: "Teen inhaler", dosage: "2 puffs", schedule: "as needed", next_dose_at: null,
        last_dose_at: null, active: true, notes: null, created_by: "parent-a", created_at: new Date("2026-09-02T00:00:00Z"),
      });
    });

    it("a parent sees every family-A medication", async () => {
      req({ as: "parentA" });
      const body = await expectNoForeignData(await GET());
      expect(body.medications.map((m: any) => m.id).sort()).toEqual(["med-a", "med-a-teen"]);
    });

    it.each<[UserKey, string, string]>([
      ["childA", "med-a", "med-a-teen"],
      ["teenA", "med-a-teen", "med-a"],
    ])("%s lists only their own medication", async (who, own, sibling) => {
      req({ as: who });
      const body = await expectNoForeignData(await GET());
      expect(body.medications.map((m: any) => m.id)).toEqual([own]);
      expect(body.medications.map((m: any) => m.id)).not.toContain(sibling);
      expect(JSON.stringify(body)).not.toContain(own === "med-a" ? "Teen inhaler" : "Home syrup");
    });

    it.each<[UserKey, string, string]>([
      ["childA", "med-a", "med-a-teen"],
      ["teenA", "med-a-teen", "med-a"],
    ])("%s may log a dose of their own medication but not a sibling's", async (who, own, sibling) => {
      expect((await medication.PATCH(req({ as: who, body: { markDoseTaken: true } }), params({ id: own }))).status).toBe(200);
      expect(db.find("medication", own)?.last_dose_at).toBeInstanceOf(Date);
      expect((await medication.PATCH(req({ as: who, body: { markDoseTaken: true } }), params({ id: sibling }))).status).toBe(404);
      expect(db.find("medication", sibling)?.last_dose_at).toBeNull();
    });

    it("a kid PATCH without a dose log is refused (prescription edits are parent-only)", async () => {
      expect((await medication.PATCH(req({ as: "childA", body: { dosage: "50ml" } }), params({ id: "med-a" }))).status).toBe(403);
      expect(db.find("medication", "med-a")?.dosage).toBe("5ml");
    });

    it("a family-B child cannot dose family A's medication", async () => {
      await expectDenied(await medication.PATCH(req({ as: "childB", body: { markDoseTaken: true } }), params({ id: "med-a" })));
      expect(db.writes).toHaveLength(0);
    });
  });
});
