// Malformed input is a 400 `{ error }`, not a 500.
//
// Each case below used to reach Prisma with an Invalid Date, a NaN `take`, a
// negative `skip`, or threw on `.trim()` of a non-string / destructuring a
// null body, and so answered 500 "Internal server error" (or, for pickups and
// allowance, threw out of a handler with no try/catch).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as messages from "../messages/route";
import * as transactions from "../budget/transactions/route";
import * as anniversaries from "../anniversaries/route";
import * as anniversary from "../anniversaries/[id]/route";
import * as pickups from "../pickups/route";
import * as pickup from "../pickups/[id]/route";
import * as allowance from "../allowance/route";
import { db, req, params, bodyOf, writesTo, fakePrisma } from "@/__tests__/helpers/two-household";

async function expect400(res: any) {
  expect(res.status).toBe(400);
  const body = await bodyOf(res);
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
}

beforeEach(() => db.reset());

describe("GET /api/messages", () => {
  it.each<Record<string, string>>([{ limit: "abc" }, { limit: "-5" }, { limit: "1.5" }, { cursor: "not-a-date" }])(
    "%p is 400",
    async (query) => {
      await expect400(await messages.GET(req({ as: "parentA", path: "/api/messages", query })));
    }
  );

  it("clamps a large limit to 100 and a zero limit to 1", async () => {
    const spy = jest.spyOn(fakePrisma.message, "findMany");
    expect((await messages.GET(req({ as: "parentA", path: "/api/messages", query: { limit: "5000" } }))).status).toBe(200);
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ take: 100 });
    expect((await messages.GET(req({ as: "parentA", path: "/api/messages", query: { limit: "0" } }))).status).toBe(200);
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ take: 1 });
    spy.mockRestore();
  });

  it("a valid cursor still pages", async () => {
    const res = await messages.GET(
      req({ as: "parentA", path: "/api/messages", query: { cursor: "2100-01-01T00:00:00Z", limit: "10" } })
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/budget/transactions", () => {
  it.each<Record<string, string>>([{ startDate: "nope" }, { endDate: "2026-13-45" }, { offset: "-1" }, { offset: "abc" }])(
    "%p is 400",
    async (query) => {
      await expect400(await transactions.GET(req({ as: "parentA", path: "/api/budget/transactions", query })));
    }
  );

  it("valid dates and offset still work, and a negative limit is clamped", async () => {
    const res = await transactions.GET(
      req({
        as: "parentA",
        path: "/api/budget/transactions",
        query: { startDate: "2020-01-01", endDate: "2100-01-01", offset: "0", limit: "-3" },
      })
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).limit).toBe(1);
  });
});

describe("POST /api/anniversaries and PATCH /api/anniversaries/[id]", () => {
  it.each([
    [null],
    [{ name: "Gran", type: "birthday", date: "not a date" }],
    [{ name: 7, type: "birthday", date: "2020-05-01" }],
    [{ name: "Gran", type: "birthday", date: "2020-05-01", notes: { x: 1 } }],
    [{ name: "Gran", type: "party", date: "2020-05-01" }],
    [{ type: "birthday", date: "2020-05-01" }],
  ])("POST %p is 400", async (body) => {
    await expect400(await anniversaries.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("anniversary")).toHaveLength(0);
  });

  it.each([[null], [{ date: "31/31/2020" }], [{ name: ["x"] }], [{ notes: 5 }], [{ type: "party" }]])(
    "PATCH %p is 400",
    async (body) => {
      await expect400(await anniversary.PATCH(req({ as: "parentA", method: "PATCH", body }), params({ id: "ann-a" })));
      expect(writesTo("anniversary")).toHaveLength(0);
    }
  );

  it("a valid create and edit still work", async () => {
    const created = await anniversaries.POST(
      req({ as: "parentA", method: "POST", body: { name: " Gran ", type: "birthday", date: "2020-05-01", notes: " " } })
    );
    expect(created.status).toBe(201);
    expect((await bodyOf(created)).date).toMatchObject({ name: "Gran", notes: null });
    const edited = await anniversary.PATCH(
      req({ as: "parentA", method: "PATCH", body: { date: "2021-06-02" } }),
      params({ id: "ann-a" })
    );
    expect(edited.status).toBe(200);
  });
});

describe("POST /api/pickups and PATCH /api/pickups/[id]", () => {
  it.each([
    [null],
    [{ title: "School", pickup_time: "soon" }],
    [{ title: 12, pickup_time: "2026-10-02T15:00:00Z" }],
    [{ title: "School", pickup_time: "2026-10-02T15:00:00Z", notes: 3 }],
    [{ title: "School", pickup_time: "2026-10-02T15:00:00Z", location: ["x"] }],
    [{ title: "   ", pickup_time: "2026-10-02T15:00:00Z" }],
  ])("POST %p is 400", async (body) => {
    await expect400(await pickups.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("pickup")).toHaveLength(0);
  });

  it("PATCH with a null body is 400", async () => {
    await expect400(await pickup.PATCH(req({ as: "parentA", method: "PATCH", body: null }), params({ id: "pickup-a" })));
    expect(writesTo("pickup")).toHaveLength(0);
  });

  it("a valid pickup is still created", async () => {
    const res = await pickups.POST(
      req({ as: "parentA", method: "POST", body: { title: " School ", pickup_time: "2026-10-02T15:00:00Z" } })
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).pickup.title).toBe("School");
  });

  it("an unexpected failure is a 500 { error }, not a thrown exception", async () => {
    const spy = jest.spyOn(fakePrisma.pickup, "create").mockRejectedValueOnce(new Error("db down"));
    const res = await pickups.POST(
      req({ as: "parentA", method: "POST", body: { title: "School", pickup_time: "2026-10-02T15:00:00Z" } })
    );
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error).toBe("Internal server error");
    spy.mockRestore();
  });
});

describe("POST /api/allowance", () => {
  it.each([
    [null],
    [{ to_user_id: "child-a", amount: 5, reason: 42 }],
    [{ to_user_id: "child-a", amount: "5" }],
    [{ to_user_id: "child-a", amount: -1 }],
    [{ to_user_id: 7, amount: 5 }],
  ])("%p is 400", async (body) => {
    await expect400(await allowance.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("allowance")).toHaveLength(0);
  });

  it("a valid allowance is still created", async () => {
    const res = await allowance.POST(
      req({ as: "parentA", method: "POST", body: { to_user_id: "child-a", amount: 5, reason: " Weekly " } })
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).allowance.reason).toBe("Weekly");
  });
});
