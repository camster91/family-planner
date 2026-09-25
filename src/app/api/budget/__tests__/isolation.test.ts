// Two-household + parent-only isolation for the budget API (#102).
// Finance is parent-only: teen and child get 403 on every handler.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as categories from "../categories/route";
import * as category from "../categories/[id]/route";
import * as stats from "../stats/route";
import * as transactions from "../transactions/route";
import * as transaction from "../transactions/[id]/route";
import { db, req, params, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newTxn = { amount: 10, type: "expense", description: "milk" };
const newCat = { name: "Fuel", type: "expense" };

describe("budget — two households, parent only", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await categories.GET(req())).status,
      (await categories.POST(req({ body: newCat }))).status,
      (await category.PATCH(req({ body: { name: "x" } }), params({ id: "cat-a" }))).status,
      (await category.DELETE(req(), params({ id: "cat-a" }))).status,
      (await stats.GET(req())).status,
      (await transactions.GET(req())).status,
      (await transactions.POST(req({ body: newTxn }))).status,
      (await transaction.PATCH(req({ body: { amount: 1 } }), params({ id: "txn-a" }))).status,
      (await transaction.DELETE(req(), params({ id: "txn-a" }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("rejects %s with 403 on every handler", async (who) => {
    const statuses = [
      (await categories.GET(req({ as: who }))).status,
      (await categories.POST(req({ as: who, body: newCat }))).status,
      (await category.PATCH(req({ as: who, body: { name: "x" } }), params({ id: "cat-a" }))).status,
      (await category.DELETE(req({ as: who }), params({ id: "cat-a" }))).status,
      (await stats.GET(req({ as: who }))).status,
      (await transactions.GET(req({ as: who }))).status,
      (await transactions.POST(req({ as: who, body: newTxn }))).status,
      (await transaction.PATCH(req({ as: who, body: { amount: 1 } }), params({ id: "txn-a" }))).status,
      (await transaction.DELETE(req({ as: who }), params({ id: "txn-a" }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([403]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const cats = await expectNoForeignData(await categories.GET(req({ as: "parentA" })));
    expect(cats.categories.map((c: any) => c.id)).toEqual(["cat-a"]);
    const txns = await expectNoForeignData(await transactions.GET(req({ as: "parentA" })));
    expect(txns.transactions.map((t: any) => t.id)).toEqual(["txn-a"]);
    // A foreign category filter cannot widen the family scope.
    const filtered = await expectNoForeignData(
      await transactions.GET(req({ as: "parentA", query: { category_id: "cat-b" } }))
    );
    expect(filtered.transactions).toEqual([]);
    const s = await expectNoForeignData(await stats.GET(req({ as: "parentA", query: { month: "2026-09" } })));
    expect(s.recent_transactions.map((t: any) => t.id)).toEqual(["txn-a"]);
  });

  it("refuses to touch another family's category or transaction", async () => {
    await expectDenied(await category.PATCH(req({ as: "parentA", body: { name: "x" } }), params({ id: "cat-b" })));
    await expectDenied(await category.DELETE(req({ as: "parentA" }), params({ id: "cat-b" })));
    await expectDenied(await transaction.PATCH(req({ as: "parentA", body: { amount: 1 } }), params({ id: "txn-b" })));
    await expectDenied(await transaction.DELETE(req({ as: "parentA" }), params({ id: "txn-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("rejects a family-B category_id on create and update", async () => {
    await expectDenied(await transactions.POST(req({ as: "parentA", body: { ...newTxn, category_id: "cat-b" } })));
    await expectDenied(
      await transaction.PATCH(req({ as: "parentA", body: { category_id: "cat-b" } }), params({ id: "txn-a" }))
    );
    expect(db.writes).toHaveLength(0);
  });

  it("lets a parent of the family create, update and delete", async () => {
    const created = await transactions.POST(req({ as: "parentA", body: { ...newTxn, category_id: "cat-a", family_id: "family-B" } }));
    expect(created.status).toBe(201);
    expect(writesTo("transaction")[0].args.data).toMatchObject({ family_id: "family-A", user_id: "parent-a" });
    expect((await categories.POST(req({ as: "parentA", body: newCat }))).status).toBe(201);
    expect((await transaction.PATCH(req({ as: "parentA", body: { amount: 7 } }), params({ id: "txn-a" }))).status).toBe(200);
    expect((await category.DELETE(req({ as: "parentA" }), params({ id: "cat-a" }))).status).toBe(200);
    expect(db.find("transaction", "txn-b")?.category_id).toBe("cat-b");
  });
});
