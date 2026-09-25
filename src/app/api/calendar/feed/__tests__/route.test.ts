// Tokenized ICS feed (#102): a feed token resolves to exactly one household and
// only that household's events are published.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import { GET } from "../route";
import { db, req, FOREIGN } from "@/__tests__/helpers/two-household";

describe("GET /api/calendar/feed", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a token or with an unknown token", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ query: { token: "nope" } }))).status).toBe(401);
  });

  it("a family-A token publishes only family-A events", async () => {
    const res = await GET(req({ query: { token: "feed-token-a" } }));
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).toContain("UID:event-a@");
    expect(ics).not.toContain("event-b");
    expect(ics).not.toContain(FOREIGN);
  });

  it("a family-B token publishes only family-B events", async () => {
    const ics = await (await GET(req({ query: { token: "feed-token-b" } }))).text();
    expect(ics).toContain("UID:event-b@");
    expect(ics).not.toContain("event-a");
  });

  it("a session cookie does not substitute for the token", async () => {
    expect((await GET(req({ as: "parentA" }))).status).toBe(401);
  });
});
