// Logging a dose must never invent the next dose time (#102 follow-up).
//
// PATCH /api/medications/[id] used to set next_dose_at = now + 12 h on every
// "Mark dose taken", whatever the free-text schedule said ("Every 4-6 hours",
// "Once daily"). A wrong "Next dose" time on a child's medicine is a safety
// problem, so a logged dose now clears next_dose_at unless the parent gives
// the next time (`next_dose_at`) or the interval (`interval_hours`, 1..48).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { PATCH } from "../[id]/route";
import { db, req, params, bodyOf } from "@/__tests__/helpers/two-household";

const HOUR = 60 * 60 * 1000;
const med = () => db.find("medication", "med-a")!;

describe("PATCH /api/medications/[id] — dose log", () => {
  beforeEach(() => {
    db.reset();
    // A next-dose time left over from an earlier dose.
    med().next_dose_at = new Date(Date.now() + 2 * HOUR);
  });

  it("records the dose and clears next_dose_at instead of guessing it", async () => {
    const before = Date.now();
    const res = await PATCH(req({ as: "parentA", body: { markDoseTaken: true } }), params({ id: "med-a" }));
    expect(res.status).toBe(200);
    expect(med().last_dose_at).toBeInstanceOf(Date);
    expect(med().last_dose_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(med().next_dose_at).toBeNull();
    expect((await bodyOf(res)).medication.next_dose_at).toBeNull();
  });

  it("a child's dose log also clears next_dose_at and ignores a next time they send", async () => {
    db.find("medication", "med-a")!.person_id = "child-a";
    const res = await PATCH(
      req({ as: "childA", body: { markDoseTaken: true, interval_hours: 1 } }),
      params({ id: "med-a" })
    );
    expect(res.status).toBe(200);
    expect(med().next_dose_at).toBeNull();
  });

  it("uses the interval a parent entered", async () => {
    const res = await PATCH(
      req({ as: "parentA", body: { markDoseTaken: true, interval_hours: 6 } }),
      params({ id: "med-a" })
    );
    expect(res.status).toBe(200);
    expect(med().next_dose_at.getTime() - med().last_dose_at.getTime()).toBe(6 * HOUR);
  });

  it("uses an explicit next dose time a parent entered", async () => {
    const next = new Date(Date.now() + 4 * HOUR).toISOString();
    const res = await PATCH(
      req({ as: "parentA", body: { markDoseTaken: true, next_dose_at: next } }),
      params({ id: "med-a" })
    );
    expect(res.status).toBe(200);
    expect(med().next_dose_at.toISOString()).toBe(next);
  });

  it("a parent can set the next dose after logging, without logging again", async () => {
    await PATCH(req({ as: "parentA", body: { markDoseTaken: true } }), params({ id: "med-a" }));
    const lastDose = med().last_dose_at;
    const next = new Date(lastDose.getTime() + 8 * HOUR).toISOString();
    const res = await PATCH(req({ as: "parentA", body: { next_dose_at: next } }), params({ id: "med-a" }));
    expect(res.status).toBe(200);
    expect(med().last_dose_at).toBe(lastDose);
    expect(med().next_dose_at.toISOString()).toBe(next);
  });

  it.each([
    [{ markDoseTaken: true, interval_hours: 0 }],
    [{ markDoseTaken: true, interval_hours: 49 }],
    [{ markDoseTaken: true, interval_hours: "6" }],
    [{ markDoseTaken: true, next_dose_at: "not a date" }],
    [{ markDoseTaken: true, interval_hours: 6, next_dose_at: new Date().toISOString() }],
    [{ interval_hours: 6 }],
    [{ markDoseTaken: "yes" }],
    [{ name: 42 }],
    [{ notes: ["x"] }],
    [null],
    ["text"],
  ])("refuses %p with 400 { error } and writes nothing", async (body) => {
    const res = await PATCH(req({ as: "parentA", body }), params({ id: "med-a" }));
    expect(res.status).toBe(400);
    expect(typeof (await bodyOf(res)).error).toBe("string");
    expect(db.writes).toHaveLength(0);
  });
});
