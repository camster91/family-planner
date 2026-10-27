// Two-household isolation for /api/meals and /api/meals/[id] (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as meals from "../route";
import * as meal from "../[id]/route";
import { db, req, writesTo, expectDenied, expectNoForeignData, FAMILY_A } from "@/__tests__/helpers/two-household";

const today = new Date().toISOString().slice(0, 10);
const newMeal = { date: today, meal_type: "lunch", recipe_name: "Soup" };

describe("meals — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await meals.GET(req())).status).toBe(401);
    expect((await meals.POST(req({ body: newMeal }))).status).toBe(401);
    expect((await meal.GET(req({ query: { id: "meal-a" } }))).status).toBe(401);
    expect((await meal.PATCH(req({ body: { id: "meal-a", notes: "x" } }))).status).toBe(401);
    expect((await meal.DELETE(req({ query: { id: "meal-a" } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await meals.GET(req({ as: "childA" })));
    expect(body.meals.map((m: any) => m.id)).toEqual(["meal-a"]);
  });

  it("reads one meal only under the captured current owner", async () => {
    const own = await meal.GET(req({ as: "parentA", query: { id: "meal-a" } }));
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({
      state: "present",
      meal: { id: "meal-a" },
      context: { userId: "parent-a", familyId: "family-A", generation: 0 },
    });
    expect(
      (await meal.GET(req({ as: "parentA", query: { id: "meal-b" } }))).status,
    ).toBe(403);
    expect(
      (
        await meal.GET(
          req({
            as: "parentA",
            query: {
              id: "meal-a",
              expected_user_id: "parent-a",
              expected_family_id: "family-A",
              expected_generation: "1",
            },
          }),
        )
      ).status,
    ).toBe(409);
    const missing = await meal.GET(
      req({ as: "parentA", query: { id: "meal-missing" } }),
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({
      state: "missing",
      meal: { id: "meal-missing" },
      context: { userId: "parent-a", familyId: "family-A", generation: 0 },
    });
  });

  it("refuses to update or delete another family's meal", async () => {
    await expectDenied(await meal.PATCH(req({ as: "parentA", body: { id: "meal-b", notes: "x" } })));
    await expectDenied(await meal.DELETE(req({ as: "parentA", query: { id: "meal-b" } })));
    expect(db.writes).toHaveLength(0);
  });

  it("checks the DELETE owner snapshot inside the locked meal authority path", async () => {
    const guarded = await meal.DELETE(
      req({
        as: "parentA",
        query: {
          id: "meal-a",
          expected_user_id: "parent-a",
          expected_family_id: FAMILY_A,
          expected_generation: "0",
        },
      }),
    );
    expect(guarded.status).toBe(200);

    db.reset();
    const stale = await meal.DELETE(
      req({
        as: "parentA",
        query: {
          id: "meal-a",
          expected_user_id: "parent-a",
          expected_family_id: FAMILY_A,
          expected_generation: "1",
        },
      }),
    );
    expect(stale.status).toBe(409);
    expect(db.find("familyMeal", "meal-a")).toBeDefined();
  });

  it("rejects a family-B cook_id and never echoes that user's name", async () => {
    const created = await meals.POST(req({ as: "parentA", body: { ...newMeal, cook_id: "parent-b" } }));
    expect(created.status).toBe(400);
    await expectNoForeignData(created);
    const updated = await meal.PATCH(req({ as: "parentA", body: { id: "meal-a", cook_id: "parent-b" } }));
    expect(updated.status).toBe(400);
    await expectNoForeignData(updated);
    expect(db.writes).toHaveLength(0);
    expect(db.find("familyMeal", "meal-a")?.cook_id).toBe("parent-a");
  });

  it("same-family create with a same-family cook, update, delete", async () => {
    const res = await meals.POST(req({ as: "childA", body: { ...newMeal, cook_id: "teen-a", family_id: "family-B" } }));
    expect(res.status).toBe(201);
    expect(writesTo("familyMeal")[0].args.data).toMatchObject({ family_id: "family-A", cook_id: "teen-a" });
    expect((await meal.PATCH(req({ as: "parentA", body: { id: "meal-a", cook_id: "teen-a" } }))).status).toBe(200);
    expect((await meal.DELETE(req({ as: "parentA", query: { id: "meal-a" } }))).status).toBe(200);
  });
});
