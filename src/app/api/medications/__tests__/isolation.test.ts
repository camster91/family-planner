// Two-household isolation for GET /api/medications and /api/medications/[id]
// (#102). POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import * as medication from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";

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
});
