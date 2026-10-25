// Tokenized ICS feed (#102): a feed token resolves to exactly one household and
// only that household's events are published.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
    work(require("@/__tests__/helpers/two-household").fakePrisma)),
} }));

import { GET } from "../route";
import { prisma } from "@/lib/prisma";
import { CALENDAR_FEED_PAGE_SIZE, CALENDAR_FEED_MAX_EVENTS, CALENDAR_FEED_MAX_BYTES } from "@/lib/calendar-feed";
import { db, req, FOREIGN, fakePrisma } from "@/__tests__/helpers/two-household";

describe("GET /api/calendar/feed", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a token or with an unknown token", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ query: { token: "nope" } }))).status).toBe(401);
  });

  it("a family-A token publishes only family-A events", async () => {
    const res = await GET(req({ query: { token: "feed-token-a" } }));
    expect(res.status).toBe(200);
    expect(prisma!.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead", timeout: 30000,
    });
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

  // Authored/unrun. The fake transaction does not prove PostgreSQL snapshot behavior.
  function pagedFeed(count: number) {
    const original = db.find("event", "event-a")!;
    const rows = Array.from({ length: count }, (_, index) => ({ ...original,
      id: `synthetic-${String(index).padStart(5, "0")}`,
    }));
    return jest.spyOn(fakePrisma.event, "findMany").mockImplementation(async (args: {
      take: number; where: { family_id: string; AND?: Array<{ OR: Array<{ id?: { gt: string } }> }> };
    }) => {
      expect(args.where.family_id).toBe("family-A");
      const cursor = args.where.AND?.[0].OR[1].id?.gt;
      const start = cursor ? rows.findIndex(row => row.id === cursor) + 1 : 0;
      return rows.slice(start, start + args.take);
    });
  }
  it("refuses overflow before emitting any partial calendar content", async () => {
    const read = pagedFeed(CALENDAR_FEED_MAX_EVENTS + 1);
    try {
      const res = await GET(req({ query: { token: "feed-token-a" } }));
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await res.json();
      expect(body.code).toBe("CALENDAR_FEED_TOO_LARGE");
      expect(JSON.stringify(body)).not.toMatch(/BEGIN:VCALENDAR|synthetic-|feed-token/);
      expect(read.mock.calls.every(([args]) => args.take <= CALENDAR_FEED_PAGE_SIZE)).toBe(true);
      expect(read.mock.calls[read.mock.calls.length - 1][0].take).toBe(1);
      expect(db.writes).toHaveLength(0);
    } finally { read.mockRestore(); }
  });
  it.each([2400, CALENDAR_FEED_MAX_EVENTS])("exports all %p equal-date events with stable ID continuation", async count => {
    const read = pagedFeed(count);
    try {
      const res = await GET(req({ query: { token: "feed-token-a" } }));
      expect(res.status).toBe(200);
      const ics = await res.text();
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(count);
      const uids = ics.split("\r\n").filter(line => line.startsWith("UID:"));
      expect(new Set(uids).size).toBe(count);
      expect(ics).toContain(`UID:synthetic-${String(count - 1).padStart(5, "0")}@family.ashbi.ca`);
      expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
      expect(read.mock.calls.every(([args]) => args.take <= CALENDAR_FEED_PAGE_SIZE)).toBe(true);
    } finally { read.mockRestore(); }
  });
  it("refuses an oversized legacy field without sending a successful prefix", async () => {
    db.find("event", "event-a")!.description = "x".repeat(CALENDAR_FEED_MAX_BYTES + 1);
    const res = await GET(req({ query: { token: "feed-token-a" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CALENDAR_FEED_TOO_LARGE");
    expect(db.writes).toHaveLength(0);
  });
});
