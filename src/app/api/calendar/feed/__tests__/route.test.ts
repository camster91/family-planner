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
  // Authored/unrun: multibyte names and supplementary characters survive
  // folding, while literal newline variants cannot create extra ICS fields.
  it("folds non-English feed text by UTF-8 bytes without splitting emoji", async () => {
    const family = db.find("family", "family-A")!;
    const event = db.find("event", "event-a")!;
    const name = "Maison 🏠 café 家族 ".repeat(12);
    const title = "Réunion 🎉 家族 ".repeat(15);
    const description = "Line one\rLine two\r\nLine three\nFINISH,semi;slash\\";
    family.name = name;
    event.title = title;
    event.description = description;
    const recurrence = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12";
    event.recurrence = "RRULE:" + recurrence;
    const res = await GET(req({ query: { token: "feed-token-a" } }));
    expect(res.status).toBe(200);
    const ics = await res.text();
    const lines = ics.split("\r\n");
    expect(lines.some(line => line.startsWith(" "))).toBe(true);
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics).not.toContain("\uFFFD");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`X-WR-CALNAME:${name}\r\n`);
    expect(unfolded).toContain(`SUMMARY:${title}\r\n`);
    expect(unfolded).toContain("DESCRIPTION:Line one\\nLine two\\nLine three\\nFINISH\\,semi\\;slash\\\\\r\n");
    expect(unfolded).toContain(`RRULE:${recurrence}\r\n`);
    expect(unfolded).toContain("UID:event-a@family.ashbi.ca\r\n");
  });

  it("keeps the previous ASCII folding widths", async () => {
    db.find("family", "family-A")!.name = "a".repeat(150);
    const ics = await (await GET(req({ query: { token: "feed-token-a" } }))).text();
    const original = "X-WR-CALNAME:" + "a".repeat(150);
    const expected = original.slice(0, 74) + "\r\n " + original.slice(74, 147) + "\r\n " + original.slice(147);
    expect(ics).toContain(expected + "\r\n");
  });

});
