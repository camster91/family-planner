// Two-household isolation for GET /api/activity (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import { db, req, expectNoForeignData, FAMILY_A } from "@/__tests__/helpers/two-household";

describe("activity — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a session", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("returns 400 for a user with no family instead of reading anything", async () => {
    expect((await GET(req({ as: "loner" }))).status).toBe(400);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await GET(req({ as: "childA" })));
    expect(body.activities.map((a: any) => a.id)).toEqual(["act-a"]);
  });

  it("keeps real event_* and events_* rows and hides legacy analytics rows", async () => {
    const base = { family_id: FAMILY_A, user_id: "parent-a", description: null, metadata: null };
    db.rows("activity").push(
      { ...base, id: "act-created", type: "event_created", title: "Event", created_at: new Date("2026-01-02T00:00:00Z") },
      { ...base, id: "act-imported", type: "events_imported", title: "Import", created_at: new Date("2026-01-03T00:00:00Z") },
      { ...base, id: "act-pageview", type: "event_page_view", title: "page", created_at: new Date("2026-01-04T00:00:00Z") },
    );
    const res = await GET(req({ as: "parentA" }));
    const ids = (await res.json()).activities.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["act-created", "act-imported", "act-a"]));
    expect(ids).not.toContain("act-pageview");
  });
});
