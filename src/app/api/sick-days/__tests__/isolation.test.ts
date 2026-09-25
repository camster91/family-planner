// Two-household isolation for GET /api/sick-days and /api/sick-days/[id]
// (#102). POST is covered by route.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import * as sickDay from "../[id]/route";
import { db, req, params, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";

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
});
