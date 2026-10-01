// Malformed form input is a 400 `{ error }` with no write, not a 500 or bad
// stored data (sibling of bad-input.test.ts).
//
// Each case below used to reach Prisma with an Invalid Date, a non-boolean, a
// non-string (or threw on `.trim()` of one, outside any try/catch), a price
// that does not fit Decimal(10,2), or a null in a NOT NULL column.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as travel from "../family/travel/route";
import * as meals from "../meals/route";
import * as meal from "../meals/[id]/route";
import * as locations from "../locations/route";
import * as sickDays from "../sick-days/route";
import * as wishlist from "../wishlist/route";
import * as wish from "../wishlist/[id]/route";
import * as notifications from "../notifications/route";
import * as contacts from "../emergency-contacts/route";
import * as contact from "../emergency-contacts/[id]/route";
import { db, req, params, bodyOf, writesTo, fakePrisma } from "@/__tests__/helpers/two-household";

async function expect400(res: any) {
  expect(res.status).toBe(400);
  const body = await bodyOf(res);
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d);

beforeEach(() => db.reset());

describe("PATCH /api/family/travel", () => {
  it.each([
    [null],
    [[1]],
    [{ travel_mode_active: "yes" }],
    [{ travel_mode_active: 1 }],
    [{ travel_start_date: "not a date" }],
    [{ travel_start_date: "2026-02-31" }],
    [{ travel_end_date: 20261001 }],
    [{ travel_end_date: "Oct 1 2026" }],
    [{ travel_destination: { city: "Lisbon" } }],
    [{ travel_destination: "x".repeat(201) }],
    [{ travel_start_date: "2026-10-10", travel_end_date: "2026-10-01" }],
  ])("%p is 400", async (body) => {
    await expect400(await travel.PATCH(req({ as: "parentA", method: "PATCH", body })));
    expect(writesTo("family")).toHaveLength(0);
  });

  it("stores YYYY-MM-DD dates as UTC midnight", async () => {
    const res = await travel.PATCH(
      req({
        as: "parentA",
        method: "PATCH",
        body: {
          travel_mode_active: true,
          travel_start_date: "2026-10-01",
          travel_end_date: "2026-10-08",
          travel_destination: " Lisbon ",
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(iso(body.travel_start_date)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(body.travel_end_date)).toBe("2026-10-08T00:00:00.000Z");
    expect(body.travel_destination).toBe("Lisbon");
    expect(body.travel_mode_active).toBe(true);
  });

  it("accepts a full ISO date-time from older clients, keeping its UTC day", async () => {
    const res = await travel.PATCH(
      req({ as: "parentA", method: "PATCH", body: { travel_start_date: "2026-10-01T18:30:00.000Z" } })
    );
    expect(res.status).toBe(200);
    expect(iso((await bodyOf(res)).travel_start_date)).toBe("2026-10-01T00:00:00.000Z");
  });

  it('"" and null clear, as the travel page sends when turning travel mode off', async () => {
    const res = await travel.PATCH(
      req({
        as: "parentA",
        method: "PATCH",
        body: { travel_mode_active: false, travel_start_date: null, travel_end_date: "", travel_destination: null },
      })
    );
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({
      travel_mode_active: false,
      travel_start_date: null,
      travel_end_date: null,
      travel_destination: null,
    });
  });
});

describe("POST /api/meals and PATCH /api/meals/[id]", () => {
  const valid = { date: "2026-10-05", meal_type: "dinner" };

  it.each([
    [null],
    [{ ...valid, recipe_name: 42 }],
    [{ ...valid, recipe_name: "x".repeat(201) }],
    [{ ...valid, notes: ["x"] }],
    [{ ...valid, notes: "x".repeat(2001) }],
    [{ ...valid, cook_id: 7 }],
    [{ ...valid, cook_id: { id: "parent-a" } }],
  ])("POST %p is 400", async (body) => {
    await expect400(await meals.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("familyMeal")).toHaveLength(0);
  });

  it.each([
    [null],
    [{}],
    [{ id: 5 }],
    [{ id: { not: "x" } }],
    [{ id: "meal-a", recipe_name: 1 }],
    [{ id: "meal-a", notes: false }],
    [{ id: "meal-a", cook_id: 3 }],
  ])("PATCH %p is 400", async (body) => {
    await expect400(await meal.PATCH(req({ as: "parentA", method: "PATCH", body })));
    expect(writesTo("familyMeal")).toHaveLength(0);
  });

  it("a valid create and edit still work", async () => {
    const created = await meals.POST(
      req({ as: "parentA", method: "POST", body: { ...valid, recipe_name: "Tacos", notes: "Spicy", cook_id: "parent-a" } })
    );
    expect(created.status).toBe(201);
    expect((await bodyOf(created)).meal).toMatchObject({ recipe_name: "Tacos", notes: "Spicy", cook_id: "parent-a" });
    const edited = await meal.PATCH(
      req({ as: "parentA", method: "PATCH", body: { id: "meal-a", recipe_name: "Soup", notes: null, cook_id: null } })
    );
    expect(edited.status).toBe(200);
    expect((await bodyOf(edited)).meal).toMatchObject({ recipe_name: "Soup", notes: null, cook_id: null });
  });
});

describe("POST /api/locations", () => {
  it.each([[null], [{}], [{ label: 5 }], [{ label: ["Home"] }], [{ label: "   " }], [{ label: "Gym", address: 12 }]])(
    "%p is 400",
    async (body) => {
      await expect400(await locations.POST(req({ as: "parentA", method: "POST", body })));
      expect(writesTo("familyLocation")).toHaveLength(0);
    }
  );

  it("a valid location is still created", async () => {
    const res = await locations.POST(req({ as: "parentA", method: "POST", body: { label: " home ", address: " " } }));
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).location).toMatchObject({ label: "home", address: null, is_primary: true });
  });

  it("an unexpected failure is a 500 { error }, not a thrown exception", async () => {
    const spy = jest.spyOn(fakePrisma.familyLocation, "create").mockRejectedValueOnce(new Error("db down"));
    const res = await locations.POST(req({ as: "parentA", method: "POST", body: { label: "Gym" } }));
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error).toBe("Internal server error");
    spy.mockRestore();
  });
});

describe("POST /api/sick-days", () => {
  it.each([
    [null],
    [{ severity: "mild" }],
    [{ person_id: "child-a" }],
    [{ person_id: 7, severity: "mild" }],
    [{ person_id: "child-a", severity: "awful" }],
    [{ person_id: "child-a", severity: "mild", symptoms: 38.5 }],
    [{ person_id: "child-a", severity: "mild", symptoms: { a: 1 } }],
  ])("%p is 400", async (body) => {
    await expect400(await sickDays.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("sickDay")).toHaveLength(0);
  });

  it("a valid sick day is still created", async () => {
    const res = await sickDays.POST(
      req({ as: "parentA", method: "POST", body: { person_id: "child-a", severity: "mild", symptoms: " Cough " } })
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).sickDay).toMatchObject({ person_id: "child-a", symptoms: "Cough" });
  });
});

describe("POST /api/wishlist and PATCH /api/wishlist/[id]", () => {
  it.each([
    [null],
    [{ title: 5 }],
    [{ title: "Bike", approx_price: "abc" }],
    [{ title: "Bike", approx_price: -1 }],
    [{ title: "Bike", approx_price: 1e8 }],
    [{ title: "Bike", approx_price: "100000000" }],
    [{ title: "Bike", approx_price: true }],
    [{ title: "Bike", link: 3 }],
    [{ title: "Bike", description: ["x"] }],
  ])("POST %p is 400", async (body) => {
    await expect400(await wishlist.POST(req({ as: "childA", method: "POST", body })));
    expect(writesTo("wishlistItem")).toHaveLength(0);
  });

  it.each([
    [null],
    [{ title: "" }],
    [{ title: null }],
    [{ approx_price: "12abc" }],
    [{ approx_price: 123456789 }],
    [{ approx_price: -0.5 }],
    [{ link: 4 }],
  ])("PATCH %p is 400", async (body) => {
    await expect400(await wish.PATCH(req({ as: "childA", method: "PATCH", body }), params({ id: "wish-a" })));
    expect(writesTo("wishlistItem")).toHaveLength(0);
  });

  it("a valid price is stored to the cent; the largest Decimal(10,2) fits", async () => {
    const created = await wishlist.POST(
      req({ as: "childA", method: "POST", body: { title: " Bike ", approx_price: 19.999, link: " " } })
    );
    expect(created.status).toBe(201);
    expect((await bodyOf(created)).item).toMatchObject({ title: "Bike", approx_price: "20", link: null });

    const edited = await wish.PATCH(
      req({ as: "childA", method: "PATCH", body: { approx_price: "99999999.99" } }),
      params({ id: "wish-a" })
    );
    expect(edited.status).toBe(200);
    expect((await bodyOf(edited)).item.approx_price).toBe("99999999.99");

    const cleared = await wish.PATCH(
      req({ as: "childA", method: "PATCH", body: { approx_price: null } }),
      params({ id: "wish-a" })
    );
    expect(cleared.status).toBe(200);
    expect((await bodyOf(cleared)).item.approx_price).toBeNull();
  });
});

describe("POST /api/notifications", () => {
  const note = { userId: "child-a", title: "Hi", message: "Dinner", type: "system" };

  it.each([
    [null],
    [{ ...note, userId: 7 }],
    [{ ...note, userId: { id: "child-a" } }],
    [{ ...note, title: 1 }],
    [{ ...note, message: ["x"] }],
    [{ ...note, title: "x".repeat(201) }],
    [{ ...note, message: "x".repeat(1001) }],
    [{ title: "Hi", message: "Dinner", type: "system" }],
  ])("%p is 400", async (body) => {
    await expect400(await notifications.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("notification")).toHaveLength(0);
  });

  it("a valid notification is still delivered", async () => {
    const res = await notifications.POST(req({ as: "parentA", method: "POST", body: note }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).success).toBe(true);
  });
});

describe("POST /api/emergency-contacts and PATCH /api/emergency-contacts/[id]", () => {
  it.each([
    [null],
    [{ relationship: "parent" }],
    [{ person_name: 5, relationship: "parent" }],
    [{ person_name: "Gran", relationship: "" }],
    [{ person_name: "Gran", relationship: "cousin" }],
    [{ person_name: "Gran", relationship: "parent", allergies: 3 }],
    [{ person_name: "Gran", relationship: "parent", notes: "x".repeat(2001) }],
  ])("POST %p is 400", async (body) => {
    await expect400(await contacts.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("emergencyContact")).toHaveLength(0);
  });

  it.each([
    [null],
    [{ person_name: null }],
    [{ person_name: "  " }],
    [{ relationship: null }],
    [{ relationship: "" }],
    [{ relationship: "cousin" }],
    [{ doctor_phone: 5551234 }],
    [{ blood_type: "x".repeat(21) }],
  ])("PATCH %p is 400", async (body) => {
    await expect400(await contact.PATCH(req({ as: "parentA", method: "PATCH", body }), params({ id: "contact-a" })));
    expect(writesTo("emergencyContact")).toHaveLength(0);
  });

  it("a valid create and edit still work; empty optional fields clear", async () => {
    const created = await contacts.POST(
      req({ as: "parentA", method: "POST", body: { person_name: " Gran ", relationship: "parent", blood_type: "" } })
    );
    expect(created.status).toBe(201);
    expect((await bodyOf(created)).contact).toMatchObject({ person_name: "Gran", blood_type: null });

    // The emergency page sends the whole form, with "" for empty fields.
    const edited = await contact.PATCH(
      req({
        as: "parentA",
        method: "PATCH",
        body: { person_name: "Kid A", relationship: "child", allergies: "", doctor_name: "Dr. Smith", extra: "ignored" },
      }),
      params({ id: "contact-a" })
    );
    expect(edited.status).toBe(200);
    const body = (await bodyOf(edited)).contact;
    expect(body).toMatchObject({ person_name: "Kid A", allergies: null, doctor_name: "Dr. Smith", blood_type: "O+" });
    expect(body.extra).toBeUndefined();
  });
});
