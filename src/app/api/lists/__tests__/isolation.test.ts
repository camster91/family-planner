// Two-household isolation for /api/lists and its item routes (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as lists from "../route";
import { POST as createList } from "../create/route";
import { GET as getItems } from "../items/route";
import { POST as createItem } from "../items/create/route";
import { PATCH as updateItem } from "../items/update/route";
import { DELETE as deleteItem } from "../items/delete/route";
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("lists — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await lists.GET(req())).status,
      (await lists.DELETE(req({ body: { listId: "list-a" } }))).status,
      (await createList(req({ body: { name: "x", type: "grocery" } }))).status,
      (await getItems(req({ query: { listId: "list-a" } }))).status,
      (await createItem(req({ body: { listId: "list-a", content: "eggs" } }))).status,
      (await updateItem(req({ body: { itemId: "item-a", checked: true } }))).status,
      (await deleteItem(req({ query: { itemId: "item-a" } }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await lists.GET(req({ as: "childA" })));
    expect(body.lists.map((l: any) => l.id)).toEqual(["list-a"]);
  });

  it("refuses to read, add to, edit or delete another family's list or items", async () => {
    await expectDenied(await getItems(req({ as: "parentA", query: { listId: "list-b" } })));
    await expectDenied(await createItem(req({ as: "parentA", body: { listId: "list-b", content: "eggs" } })));
    await expectDenied(await updateItem(req({ as: "parentA", body: { itemId: "item-b", checked: true } })));
    await expectDenied(await deleteItem(req({ as: "parentA", query: { itemId: "item-b" } })));
    await expectDenied(await lists.DELETE(req({ as: "parentA", body: { listId: "list-b" } })));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot delete lists or items", async (who) => {
    expect((await lists.DELETE(req({ as: who, body: { listId: "list-a" } }))).status).toBe(403);
    expect((await deleteItem(req({ as: who, query: { itemId: "item-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("D9: a child cannot create a list", async () => {
    const res = await createList(req({ as: "childA", body: { name: "Party", type: "todo" } }));
    expect(res.status).toBe(403);
    expect(writesTo("list")).toHaveLength(0);
  });

  it.each<[UserKey]>([["parentA"], ["teenA"]])("D9: %s can create a list, pinned to their own family", async (who) => {
    const created = await createList(req({ as: who, body: { name: "Party", type: "todo", family_id: "family-B" } }));
    expect(created.status).toBe(200);
    expect(writesTo("list")[0].args.data).toMatchObject({ family_id: "family-A" });
  });

  it("D9: a family-B child cannot add to or tick family A's list", async () => {
    await expectDenied(await createItem(req({ as: "childB", body: { listId: "list-a", content: "eggs" } })));
    await expectDenied(await updateItem(req({ as: "childB", body: { itemId: "item-a", checked: true } })));
    expect(db.writes).toHaveLength(0);
  });

  it("same-family members can read, add and tick items", async () => {
    const items = await expectNoForeignData(await getItems(req({ as: "childA", query: { listId: "list-a" } })));
    expect(items.items.map((i: any) => i.id)).toEqual(["item-a"]);
    expect((await createItem(req({ as: "childA", body: { listId: "list-a", content: "eggs" } }))).status).toBe(200);
    expect((await updateItem(req({ as: "childA", body: { itemId: "item-a", checked: true } }))).status).toBe(200);
    expect((await deleteItem(req({ as: "parentA", query: { itemId: "item-a" } }))).status).toBe(200);
  });
});
