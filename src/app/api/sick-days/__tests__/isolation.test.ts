// Two-household isolation for GET /api/sick-days and /api/sick-days/[id]
// (#102). POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET, POST } from "../route";
import * as sickDay from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("sick days — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    req({ as: null });
    expect((await GET()).status).toBe(401);
    expect((await sickDay.PATCH(req({ body: { notes: "x" } }), params({ id: "sick-a" }))).status).toBe(401);
    expect((await sickDay.DELETE(req(), params({ id: "sick-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family, with only that family's medications", async () => {
    req({ as: "parentA" });
    const body = await expectNoForeignData(await GET());
    expect(body.sickDays.map((s: any) => s.id)).toEqual(["sick-a"]);
    expect(body.sickDays[0].medications.map((m: any) => m.id)).toEqual(["med-a"]);
  });

  it("refuses to update or delete another family's sick day", async () => {
    await expectDenied(await sickDay.PATCH(req({ as: "parentA", body: { notes: "x" } }), params({ id: "sick-b" })));
    await expectDenied(
      await sickDay.PATCH(req({ as: "parentA", body: { addTemperature: { value: 39, unit: "C" } } }), params({ id: "sick-b" }))
    );
    await expectDenied(await sickDay.DELETE(req({ as: "parentA" }), params({ id: "sick-b" })));
    expect(db.writes).toHaveLength(0);
    expect(db.find("sickDay", "sick-b")?.notes).toBeNull();
  });

  it("a same-family member can update the sick day", async () => {
    expect((await sickDay.PATCH(req({ as: "parentA", body: { notes: "better" } }), params({ id: "sick-a" }))).status).toBe(200);
    expect(db.find("sickDay", "sick-a")?.notes).toBe("better");
  });

  describe("D1: teen/child see only their own sick days", () => {
    beforeEach(() => {
      db.rows("sickDay").push({
        id: "sick-a-teen", family_id: "family-A", person_id: "teen-a", started_at: new Date("2026-09-02T00:00:00Z"),
        ended_at: null, symptoms: "Teen headache", severity: "mild", status: "active", temperature_log: [],
        notes: null, created_by: "parent-a", created_at: new Date("2026-09-02T00:00:00Z"),
      });
      db.rows("medication").push({
        id: "med-a-teen", family_id: "family-A", sick_day_id: "sick-a-teen", person_id: "teen-a",
        name: "Teen inhaler", dosage: "2 puffs", schedule: "as needed", next_dose_at: null,
        last_dose_at: null, active: true, notes: null, created_by: "parent-a", created_at: new Date("2026-09-02T00:00:00Z"),
      });
    });

    it("a parent sees every family-A sick day", async () => {
      req({ as: "parentA" });
      const body = await expectNoForeignData(await GET());
      expect(body.sickDays.map((s: any) => s.id).sort()).toEqual(["sick-a", "sick-a-teen"]);
    });

    it.each<[UserKey, string, string, string]>([
      ["childA", "sick-a", "sick-a-teen", "Teen headache"],
      ["teenA", "sick-a-teen", "sick-a", "Home cough"],
    ])("%s lists only their own sick day and medications", async (who, own, sibling, siblingText) => {
      req({ as: who });
      const body = await expectNoForeignData(await GET());
      expect(body.sickDays.map((s: any) => s.id)).toEqual([own]);
      expect(JSON.stringify(body)).not.toContain(siblingText);
      expect(body.sickDays.map((s: any) => s.id)).not.toContain(sibling);
    });

    it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot edit or delete sick days (own: 403, sibling: 404)", async (who) => {
      const own = who === "teenA" ? "sick-a-teen" : "sick-a";
      const sibling = who === "teenA" ? "sick-a" : "sick-a-teen";
      expect((await sickDay.PATCH(req({ as: who, body: { notes: "x" } }), params({ id: own }))).status).toBe(403);
      expect((await sickDay.DELETE(req({ as: who }), params({ id: own }))).status).toBe(403);
      expect((await sickDay.PATCH(req({ as: who, body: { notes: "x" } }), params({ id: sibling }))).status).toBe(404);
      expect((await sickDay.DELETE(req({ as: who }), params({ id: sibling }))).status).toBe(404);
      expect(db.writes).toHaveLength(0);
    });

    it.each<[UserKey, string, string]>([
      ["childA", "child-a", "teen-a"],
      ["teenA", "teen-a", "child-a"],
    ])("%s may report themselves sick but not a sibling", async (who, self, sibling) => {
      expect((await POST(req({ as: who, body: { person_id: sibling, severity: "mild" } }))).status).toBe(403);
      const res = await POST(req({ as: who, body: { person_id: self, severity: "mild", family_id: "family-B" } }));
      expect(res.status).toBe(201);
      expect(db.writes.filter((w) => w.model === "sickDay")).toHaveLength(1);
      expect(db.writes[0].args.data).toMatchObject({ family_id: "family-A", person_id: self });
    });

    it("a family-B child cannot touch family A's sick day", async () => {
      await expectDenied(await sickDay.PATCH(req({ as: "childB", body: { notes: "x" } }), params({ id: "sick-a" })));
      await expectDenied(await sickDay.DELETE(req({ as: "childB" }), params({ id: "sick-a" })));
      expect(db.writes).toHaveLength(0);
    });
  });
});
