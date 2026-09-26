// Two-household isolation for /api/emergency-contacts (#102). Read access for
// kids is deliberate (src/lib/kid-access.ts): a child home alone must be able
// to find contacts and medical details.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as contacts from "../route";
import * as contact from "../[id]/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newContact = { person_name: "Gran", relationship: "parent" };

describe("emergency contacts — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await contacts.GET(req())).status).toBe(401);
    expect((await contacts.POST(req({ body: newContact }))).status).toBe(401);
    expect((await contact.PATCH(req({ body: { notes: "x" } }), params({ id: "contact-a" }))).status).toBe(401);
    expect((await contact.DELETE(req(), params({ id: "contact-a" }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family (child included, by design)", async () => {
    const body = await expectNoForeignData(await contacts.GET(req({ as: "childA" })));
    expect(body.contacts.map((c: any) => c.id)).toEqual(["contact-a"]);
  });

  it("refuses to update or delete another family's contact", async () => {
    await expectDenied(await contact.PATCH(req({ as: "parentA", body: { notes: "x" } }), params({ id: "contact-b" })));
    await expectDenied(await contact.DELETE(req({ as: "parentA" }), params({ id: "contact-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("rejects a family-B person_id on create and update", async () => {
    expect((await contacts.POST(req({ as: "parentA", body: { ...newContact, person_id: "child-b" } }))).status).toBe(400);
    expect(
      (await contact.PATCH(req({ as: "parentA", body: { person_id: "child-b" } }), params({ id: "contact-a" }))).status
    ).toBe(400);
    expect(db.writes).toHaveLength(0);
  });

  it("same-family create and update", async () => {
    const res = await contacts.POST(req({ as: "parentA", body: { ...newContact, person_id: "teen-a", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("emergencyContact")[0].args.data).toMatchObject({ family_id: "family-A", person_id: "teen-a" });
    expect((await contact.PATCH(req({ as: "parentA", body: { person_id: "teen-a" } }), params({ id: "contact-a" }))).status).toBe(200);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D1: %s can read but not create, edit or delete contacts", async (who) => {
    const body = await expectNoForeignData(await contacts.GET(req({ as: who })));
    expect(body.contacts.map((c: any) => c.id)).toEqual(["contact-a"]);
    expect((await contacts.POST(req({ as: who, body: newContact }))).status).toBe(403);
    expect((await contact.PATCH(req({ as: who, body: { notes: "x" } }), params({ id: "contact-a" }))).status).toBe(403);
    expect((await contact.DELETE(req({ as: who }), params({ id: "contact-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("D1: a parent can delete their own family's contact", async () => {
    expect((await contact.DELETE(req({ as: "parentA" }), params({ id: "contact-a" }))).status).toBe(200);
  });

  it("D1: a family-B child is denied family A's contact without leaking it", async () => {
    await expectDenied(await contact.PATCH(req({ as: "childB", body: { notes: "x" } }), params({ id: "contact-a" })));
    await expectDenied(await contact.DELETE(req({ as: "childB" }), params({ id: "contact-a" })));
    expect(db.writes).toHaveLength(0);
  });
});
