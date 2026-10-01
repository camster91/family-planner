// Malformed bodies and query strings are a 400 `{ error }` with no write, not a
// 500 (sibling of bad-input.test.ts and bad-input-forms.test.ts).
//
// Each case below used to throw: destructuring or reading a field of a null
// body, `.trim()` of a non-string (or of null), a non-string reaching Prisma,
// a NaN `take` or an Invalid Date cursor. Handlers that had no outer
// try/catch now answer an unexpected failure with 500 `{ error }`.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/notifications-server", () => require("@/__tests__/helpers/two-household").notificationsMock);

import * as features from "../family/features/route";
import * as notes from "../notes/route";
import * as note from "../notes/[id]/route";
import * as handoffs from "../handoff/route";
import * as handoff from "../handoff/[id]/route";
import * as wishStatus from "../wishlist/[id]/status/route";
import * as activity from "../activity/route";
import * as rewardsApprove from "../rewards/approve/route";
import * as pickup from "../pickups/[id]/route";
import * as medications from "../medications/route";
import * as medication from "../medications/[id]/route";
import * as allowanceItem from "../allowance/[id]/route";
import { db, req, params, bodyOf, writesTo, fakePrisma } from "@/__tests__/helpers/two-household";

async function expect400(res: any) {
  expect(res.status).toBe(400);
  const body = await bodyOf(res);
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
}

async function expect500(res: any) {
  expect(res.status).toBe(500);
  expect((await bodyOf(res)).error).toBe("Internal server error");
}

beforeEach(() => db.reset());

describe("PATCH /api/family/features", () => {
  it.each([[null], [[1]], ["notes"], [42], [{ features: [true] }], [{ key: 7, enabled: true }], [{}]])(
    "%p is 400",
    async (body) => {
      await expect400(await features.PATCH(req({ as: "parentA", method: "PATCH", body })));
      expect(writesTo("family")).toHaveLength(0);
      expect(writesTo("auditLog")).toHaveLength(0);
    }
  );

  it("a single toggle and a bulk update still work", async () => {
    let res = await features.PATCH(req({ as: "parentA", method: "PATCH", body: { key: "notes", enabled: false } }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).features.notes).toBe(false);

    res = await features.PATCH(req({ as: "parentA", method: "PATCH", body: { features: { notes: true, budget: false } } }));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ features: { notes: true, budget: false } });
  });

  it("an unexpected failure is a 500 { error }, not a thrown exception", async () => {
    const spy = jest.spyOn(fakePrisma.family, "update").mockRejectedValueOnce(new Error("db down"));
    await expect500(await features.PATCH(req({ as: "parentA", method: "PATCH", body: { key: "notes", enabled: false } })));
    spy.mockRestore();
  });
});

describe("POST /api/notes", () => {
  it.each([
    [null],
    [[1]],
    [{}],
    [{ title: 42 }],
    [{ title: "   " }],
    [{ title: "x".repeat(201) }],
    [{ title: "Wifi", body: 42 }],
    [{ title: "Wifi", body: { text: "x" } }],
  ])("%p is 400", async (body) => {
    await expect400(await notes.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("pinnedNote")).toHaveLength(0);
  });

  it("a valid note is still created; an unknown colour falls back to yellow", async () => {
    const res = await notes.POST(
      req({ as: "parentA", method: "POST", body: { title: " Wifi ", body: " hunter2 ", color: 7 } })
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).note).toMatchObject({ title: "Wifi", body: "hunter2", color: "yellow" });

    const res2 = await notes.POST(req({ as: "parentA", method: "POST", body: { title: "Bins", body: null, color: "pink" } }));
    expect(res2.status).toBe(201);
    expect((await bodyOf(res2)).note).toMatchObject({ title: "Bins", body: "", color: "pink" });
  });
});

describe("PATCH and DELETE /api/notes/[id]", () => {
  it.each([
    [null],
    [[1]],
    [{}],
    [{ id: 7 }],
    [{ id: "note-a", title: 42 }],
    [{ id: "note-a", title: null }],
    [{ id: "note-a", title: "  " }],
    [{ id: "note-a", body: ["x"] }],
  ])("PATCH %p is 400", async (body) => {
    await expect400(await note.PATCH(req({ as: "parentA", method: "PATCH", body })));
    expect(writesTo("pinnedNote")).toHaveLength(0);
  });

  it("a valid edit still works; a null body clears it", async () => {
    const res = await note.PATCH(
      req({ as: "parentA", method: "PATCH", body: { id: "note-a", title: " Router ", body: null, color: "blue" } })
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).note).toMatchObject({ title: "Router", body: "", color: "blue" });
  });

  it.each([[null], [[1]], [{}], [{ id: 7 }]])("DELETE %p is 400", async (body) => {
    await expect400(await note.DELETE(req({ as: "parentA", method: "DELETE", body })));
    expect(writesTo("pinnedNote")).toHaveLength(0);
  });

  it("a valid delete still works", async () => {
    const res = await note.DELETE(req({ as: "parentA", method: "DELETE", body: { id: "note-a" } }));
    expect(res.status).toBe(200);
    expect(db.find("pinnedNote", "note-a")).toBeUndefined();
  });
});

describe("POST /api/handoff and PATCH /api/handoff/[id]", () => {
  const valid = { sitter_name: "Sam" };

  it.each([
    [null],
    [[1]],
    [{}],
    [{ sitter_name: 42 }],
    [{ sitter_name: "  " }],
    [{ ...valid, sitter_phone: 5551234 }],
    [{ ...valid, code_words: { word: "x" } }],
    [{ ...valid, general_notes: ["x"] }],
    [{ ...valid, pet_care: "x".repeat(5001) }],
    [{ ...valid, arrival_time: 20261001 }],
    [{ ...valid, departure_time: "not a date" }],
  ])("POST %p is 400", async (body) => {
    await expect400(await handoffs.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("handoff")).toHaveLength(0);
  });

  it("a valid handoff is still created", async () => {
    const res = await handoffs.POST(
      req({
        as: "parentA",
        method: "POST",
        body: {
          sitter_name: " Sam ",
          sitter_phone: "",
          code_words: " pineapple ",
          arrival_time: "2026-10-02T17:00:00.000Z",
          departure_time: null,
          pet_care: null,
        },
      })
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).handoff).toMatchObject({
      sitter_name: "Sam",
      sitter_phone: null,
      code_words: "pineapple",
      pet_care: null,
    });
  });

  it.each([
    [null],
    [[1]],
    [{ sitter_name: null }],
    [{ sitter_name: 42 }],
    [{ sitter_name: "" }],
    [{ sitter_phone: 5551234 }],
    [{ kids_bedtimes: true }],
    [{ arrival_time: 1 }],
  ])("PATCH %p is 400", async (body) => {
    await expect400(await handoff.PATCH(req({ as: "parentA", method: "PATCH", body }), params({ id: "handoff-a" })));
    expect(writesTo("handoff")).toHaveLength(0);
  });

  it("a valid edit still works; null clears a text field", async () => {
    const res = await handoff.PATCH(
      req({ as: "parentA", method: "PATCH", body: { sitter_name: " Alex ", code_words: null, pet_care: " Feed cat " } }),
      params({ id: "handoff-a" })
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).handoff).toMatchObject({ sitter_name: "Alex", code_words: null, pet_care: "Feed cat" });
  });
});

describe("PATCH /api/wishlist/[id]/status", () => {
  it.each([
    [null],
    [[1]],
    [{}],
    [{ status: 7 }],
    [{ status: "lost" }],
    [{ status: "denied" }],
    [{ status: "denied", denied_reason: "  " }],
    [{ status: "denied", denied_reason: 42 }],
    [{ status: "denied", denied_reason: { why: "x" } }],
    [{ status: "denied", denied_reason: "x".repeat(501) }],
  ])("%p is 400", async (body) => {
    await expect400(await wishStatus.PATCH(req({ as: "parentA", method: "PATCH", body }), params({ id: "wish-a" })));
    expect(writesTo("wishlistItem")).toHaveLength(0);
  });

  it("valid status changes still work", async () => {
    let res = await wishStatus.PATCH(
      req({ as: "parentA", method: "PATCH", body: { status: "denied", denied_reason: " Too pricey " } }),
      params({ id: "wish-a" })
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).item).toMatchObject({ status: "denied", denied_reason: "Too pricey" });

    res = await wishStatus.PATCH(
      req({ as: "parentA", method: "PATCH", body: { status: "on_the_way", denied_reason: "ignored" } }),
      params({ id: "wish-a" })
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).item).toMatchObject({ status: "on_the_way", denied_reason: null });
  });
});

describe("GET /api/activity", () => {
  it.each<Record<string, string>>([{ limit: "abc" }, { limit: "-5" }, { limit: "1.5" }, { cursor: "garbage" }])(
    "%p is 400",
    async (query) => {
      const spy = jest.spyOn(fakePrisma.activity, "findMany");
      await expect400(await activity.GET(req({ as: "parentA", path: "/api/activity", query })));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  );

  it("clamps a large limit to 100 and a zero limit to 1; a valid cursor still pages", async () => {
    const spy = jest.spyOn(fakePrisma.activity, "findMany");
    expect((await activity.GET(req({ as: "parentA", path: "/api/activity", query: { limit: "5000" } }))).status).toBe(200);
    expect(spy.mock.calls[0][0]).toMatchObject({ take: 100 });
    expect((await activity.GET(req({ as: "parentA", path: "/api/activity", query: { limit: "0" } }))).status).toBe(200);
    expect(spy.mock.calls[1][0]).toMatchObject({ take: 1 });
    const res = await activity.GET(
      req({ as: "parentA", path: "/api/activity", query: { cursor: "2099-01-01T00:00:00.000Z" } })
    );
    expect(res.status).toBe(200);
    expect(spy.mock.calls[2][0]).toMatchObject({ take: 30 });
    expect((spy.mock.calls[2][0] as any).where.created_at.lt).toEqual(new Date("2099-01-01T00:00:00.000Z"));
    expect((await bodyOf(res)).activities.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe("POST /api/rewards/approve", () => {
  it.each([[null], [[1]], ["reward-a"], [{}], [{ rewardId: 7 }]])("%p is 400", async (body) => {
    await expect400(await rewardsApprove.POST(req({ as: "parentA", method: "POST", body })));
    expect(writesTo("reward")).toHaveLength(0);
  });

  it("a valid approval still works", async () => {
    Object.assign(db.find("reward", "reward-a")!, { status: "claimed", claimed_by: "child-a" });
    const res = await rewardsApprove.POST(req({ as: "parentA", method: "POST", body: { rewardId: "reward-a" } }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).reward).toMatchObject({ status: "redeemed", approved: true });
  });
});

describe("handlers that had no outer try/catch", () => {
  it("PATCH /api/pickups/[id]: a failure is 500 { error }", async () => {
    const spy = jest.spyOn(fakePrisma.pickup, "update").mockRejectedValueOnce(new Error("db down"));
    await expect500(
      await pickup.PATCH(req({ as: "parentA", method: "PATCH", body: { completed: true } }), params({ id: "pickup-a" }))
    );
    spy.mockRestore();
  });

  it("DELETE /api/pickups/[id]: a failure is 500 { error }", async () => {
    const spy = jest.spyOn(fakePrisma.pickup, "delete").mockRejectedValueOnce(new Error("db down"));
    await expect500(await pickup.DELETE(req({ as: "parentA", method: "DELETE" }), params({ id: "pickup-a" })));
    spy.mockRestore();
  });

  it("POST /api/medications: a failure is 500 { error }", async () => {
    const spy = jest.spyOn(fakePrisma.medication, "create").mockRejectedValueOnce(new Error("db down"));
    await expect500(
      await medications.POST(
        req({
          as: "parentA",
          method: "POST",
          body: { person_id: "child-a", name: "Syrup", dosage: "5ml", schedule: "every 6h" },
        })
      )
    );
    spy.mockRestore();
  });

  it("PATCH and DELETE /api/medications/[id]: a failure is 500 { error }", async () => {
    let spy = jest.spyOn(fakePrisma.medication, "update").mockRejectedValueOnce(new Error("db down"));
    await expect500(
      await medication.PATCH(req({ as: "parentA", method: "PATCH", body: { markDoseTaken: true } }), params({ id: "med-a" }))
    );
    spy.mockRestore();
    spy = jest.spyOn(fakePrisma.medication, "delete").mockRejectedValueOnce(new Error("db down"));
    await expect500(await medication.DELETE(req({ as: "parentA", method: "DELETE" }), params({ id: "med-a" })));
    spy.mockRestore();
  });

  it("PATCH /api/allowance/[id]: a failure is 500 { error }", async () => {
    const spy = jest.spyOn(fakePrisma.allowance, "update").mockRejectedValueOnce(new Error("db down"));
    await expect500(
      await allowanceItem.PATCH(req({ as: "parentA", method: "PATCH", body: { status: "paid" } }), params({ id: "allow-a" }))
    );
    spy.mockRestore();
  });

  it("the same handlers still succeed", async () => {
    expect(
      (await pickup.PATCH(req({ as: "parentA", method: "PATCH", body: { completed: true } }), params({ id: "pickup-a" })))
        .status
    ).toBe(200);
    expect(
      (await medication.PATCH(req({ as: "parentA", method: "PATCH", body: { markDoseTaken: true } }), params({ id: "med-a" })))
        .status
    ).toBe(200);
    expect(
      (
        await medications.POST(
          req({
            as: "parentA",
            method: "POST",
            body: { person_id: "child-a", name: "Syrup", dosage: "5ml", schedule: "every 6h" },
          })
        )
      ).status
    ).toBe(201);
    expect(
      (await allowanceItem.PATCH(req({ as: "parentA", method: "PATCH", body: { status: "paid" } }), params({ id: "allow-a" })))
        .status
    ).toBe(200);
    expect((await pickup.DELETE(req({ as: "parentA", method: "DELETE" }), params({ id: "pickup-a" }))).status).toBe(200);
    expect((await medication.DELETE(req({ as: "parentA", method: "DELETE" }), params({ id: "med-a" }))).status).toBe(200);
  });
});
