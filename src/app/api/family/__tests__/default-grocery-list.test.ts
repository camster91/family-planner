// A new household starts with a "Groceries" list (owner-approved review A4).
//
// PostgreSQL path, route level on the two-household harness: POST /api/family
// creates the family, the membership and the list inside the one existing
// creation transaction. The native D1 batch is covered in
// src/lib/cloudflare/__tests__/family-create-groceries.test.ts.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);

import { POST as createFamily } from "../route";
import { db, req, writesTo, bodyOf, FAMILY_A } from "@/__tests__/helpers/two-household";

describe("POST /api/family creates the first grocery list", () => {
  beforeEach(() => db.reset());

  it("writes one Groceries list for the new household, created by the new parent", async () => {
    const res = await createFamily(req({ as: "loner", body: { name: "Brand new" } }));
    expect(res.status).toBe(200);
    const family = (await bodyOf(res)).family as { id: string };
    const created = writesTo("list").filter((w) => w.op === "create");
    expect(created).toHaveLength(1);
    expect(created[0].args.data).toEqual({
      family_id: family.id,
      name: "Groceries",
      type: "grocery",
      created_by: db.find("user", "loner")!.id,
    });
    expect(family.id).not.toBe(FAMILY_A);
  });

  it("is idempotent: a second create is refused and adds no list", async () => {
    expect((await createFamily(req({ as: "loner", body: { name: "First" } }))).status).toBe(200);
    const again = await createFamily(req({ as: "loner", body: { name: "Second" } }));
    expect(again.status).toBe(400);
    expect(writesTo("list").filter((w) => w.op === "create")).toHaveLength(1);
  });

  it("a member of a household cannot create another one, so no list is written", async () => {
    const res = await createFamily(req({ as: "parentA", body: { name: "Another" } }));
    expect(res.status).toBe(400);
    expect(writesTo("list").filter((w) => w.op === "create")).toHaveLength(0);
  });
});
