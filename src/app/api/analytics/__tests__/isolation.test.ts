// Two-household isolation for /api/analytics and /api/analytics/event (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import { POST as track } from "../event/route";
import { db, req, writesTo, expectNoForeignData } from "@/__tests__/helpers/two-household";

describe("analytics — two households", () => {
  beforeEach(() => db.reset());

  it("GET returns 401 without a session", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("GET aggregates only the caller's family", async () => {
    const body = await expectNoForeignData(await GET(req({ as: "parentA" })));
    expect(body.memberParticipation.map((m: any) => m.id).sort()).toEqual(["child-a", "parent-a", "teen-a"]);
    expect(body.summary.totalChores).toBe(1);
  });

  it("event POST is a no-op for anonymous callers", async () => {
    const res = await track(req({ body: { event: "page_view" } }));
    expect(res.status).toBe(200);
    expect(writesTo()).toHaveLength(0);
  });

  it("event POST writes to the caller's own family, ignoring a smuggled family", async () => {
    const res = await track(req({ as: "childA", body: { event: "page_view", family_id: "family-B" } }));
    expect(res.status).toBe(200);
    const row = db.rows("activity").find((a) => a.type === "event_page_view");
    expect(row).toMatchObject({ family_id: "family-A", user_id: "child-a" });
  });
});
