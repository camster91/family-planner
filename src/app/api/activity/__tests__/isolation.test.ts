// Two-household isolation for GET /api/activity (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import { GET } from "../route";
import { db, req, expectNoForeignData } from "@/__tests__/helpers/two-household";

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
});
