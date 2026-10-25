/** Authored/unrun: parent-only two-household source diagnostics. */
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
import { GET } from "../route";
import { db, req, FOREIGN } from "@/__tests__/helpers/two-household";
import { feedReviewCursor } from "@/lib/calendar-feed-review";
beforeEach(() => db.reset());
it("requires a parent session; a feed token alone grants no diagnostic access", async () => {
  for (const request of [req(), req({ query: { token: "feed-token-a" } }), req({ as: "teenA" }), req({ as: "childA" })])
    expect([401, 403]).toContain((await GET(request)).status);
  expect(db.writes).toHaveLength(0);
});
it("returns only the current household's minimal affected-event fields", async () => {
  db.find("event", "event-a")!.recurrence = "FREQ=DAILY;INTERVAL=0";
  db.find("event", "event-b")!.recurrence = "FREQ=BAD";
  const response = await GET(req({ as: "parentA", headers: { "X-Herewoven-Feed-Review-Household": "family-A" } }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(body.issues.map((row: { id: string }) => row.id)).toEqual(["event-a"]);
  expect(JSON.stringify(body)).not.toMatch(new RegExp(`${FOREIGN}|feed-token|INTERVAL|recurrence|description|location`));
  expect(db.writes).toHaveLength(0);
});
it("paginates explicit100-root groups without declaring the prefix complete", async () => {
  const original = db.find("event", "event-a")!;
  db.tables.event = Array.from({ length: 101 }, (_, i) => ({ ...original,
    id: `review-${String(i).padStart(3, "0")}`, title: `Fixture ${i}`, recurrence: "FREQ=BAD",
  }));
  const first = await (await GET(req({ as: "parentA", headers: { "X-Herewoven-Feed-Review-Household": "family-A" } }))).json();
  expect(first.checked).toBe(100); expect(first.issues).toHaveLength(100);
  expect(first.nextCursor).toEqual(expect.any(String));
  const last = await (await GET(req({ as: "parentA", headers: { "X-Herewoven-Feed-Review-Household": "family-A" }, query: { cursor: first.nextCursor } }))).json();
  expect(last.checked).toBe(1); expect(last.issues[0].id).toBe("review-100"); expect(last.nextCursor).toBeNull();
});
it("refuses a foreign-household cursor even for a current parent", async () => {
  const response = await GET(req({ as: "parentA", headers: { "X-Herewoven-Feed-Review-Household": "family-A" }, query: { cursor: feedReviewCursor("family-B", "event-b") } }));
  expect(response.status).toBe(400);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(db.writes).toHaveLength(0);
});

it("refuses stale displayed household scope before reading current-household diagnostics", async () => {
  const response = await GET(req({ as: "parentA", headers: { "X-Herewoven-Feed-Review-Household": "family-B" } }));
  expect(response.status).toBe(409);
  expect(db.writes).toHaveLength(0);
});
