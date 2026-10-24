// Two-household isolation for /api/wishlist, /[id] and /[id]/status (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as wishlist from "../route";
import * as item from "../[id]/route";
import { PATCH as setStatus } from "../[id]/status/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("wishlist — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await wishlist.GET(req())).status,
      (await item.GET(req(), params({ id: "wish-a" }))).status,
      (await wishlist.POST(req({ body: { title: "x" } }))).status,
      (await item.PATCH(req({ body: { title: "x" } }), params({ id: "wish-a" }))).status,
      (await item.DELETE(req(), params({ id: "wish-a" }))).status,
      (await setStatus(req({ body: { status: "received" } }), params({ id: "wish-a" }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await wishlist.GET(req({ as: "teenA" })));
    expect(body.items.map((i: any) => i.id)).toEqual(["wish-a"]);
  });

  it("reads one owned canonical item for recovery without a write", async () => {
    const response = await item.GET(req({ as: "parentA" }), params({ id: "wish-a" }));
    expect(response.status).toBe(200);
    const body = await expectNoForeignData(response);
    expect(body.item.id).toBe("wish-a");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(db.writes).toHaveLength(0);
  });

  it("filters a paged personal view before the row cap and never uses a supplied family", async () => {
    const response = await wishlist.GET(req({ as: "childA", query: {
      limit: "1", mine: "true", family_id: "family-B",
    } }));
    const body = await expectNoForeignData(response);
    expect(body.items.map((row: any) => row.id)).toEqual(["wish-a"]);
    expect(body.nextCursor).toBeNull();
    const sibling = await wishlist.GET(req({ as: "teenA", query: { limit: "1", mine: "true" } }));
    expect((await sibling.json()).items).toEqual([]);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses to edit, delete or change status of another family's item", async () => {
    await expectDenied(await item.GET(req({ as: "parentA" }), params({ id: "wish-b" })));
    await expectDenied(await item.PATCH(req({ as: "parentA", body: { title: "x" } }), params({ id: "wish-b" })));
    await expectDenied(await item.DELETE(req({ as: "parentA" }), params({ id: "wish-b" })));
    await expectDenied(await setStatus(req({ as: "parentA", body: { status: "received" } }), params({ id: "wish-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"]])("%s cannot edit a sibling's item or change any status", async (who) => {
    expect((await item.PATCH(req({ as: who, body: { title: "x" } }), params({ id: "wish-a" }))).status).toBe(403);
    expect((await item.DELETE(req({ as: who }), params({ id: "wish-a" }))).status).toBe(403);
    expect((await setStatus(req({ as: who, body: { status: "received" } }), params({ id: "wish-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("the requester edits their own item; a parent sets its status", async () => {
    expect((await item.PATCH(req({ as: "childA", body: { title: "Red bike" } }), params({ id: "wish-a" }))).status).toBe(200);
    expect((await setStatus(req({ as: "parentA", body: { status: "on_the_way" } }), params({ id: "wish-a" }))).status).toBe(200);
    const created = await wishlist.POST(req({ as: "teenA", body: { title: "Book", family_id: "family-B" } }));
    expect(created.status).toBe(201);
    expect(writesTo("wishlistItem").find((w) => w.op === "create")?.args.data).toMatchObject({
      family_id: "family-A",
      requested_by: "teen-a",
    });
  });
});
