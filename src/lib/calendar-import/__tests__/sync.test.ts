// Sync semantics for read-only ICS subscriptions (#232): idempotency, deletion,
// local-event safety, error states, household isolation and content-free logs.

jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/rate-limit-db", () => {
  const windows = new Map<string, number>();
  return {
    __reset: () => windows.clear(),
    checkRateLimit: async (key: string, max: number, windowMs: number) => {
      const now = Date.now();
      const used = windows.get(key);
      if (used !== undefined && used >= max)
        return { allowed: false, remaining: 0, retryAfterMs: windowMs };
      windows.set(key, (used ?? 0) + 1);
      setTimeout(() => windows.delete(key), windowMs).unref?.();
      return { allowed: true, remaining: max - 1, retryAfterMs: 0 + now * 0 };
    },
  };
});

import {
  db,
  fakePrisma,
  writesTo,
  FAMILY_A,
  FAMILY_B,
} from "@/__tests__/helpers/two-household";
import {
  refreshStaleSubscriptions,
  removeSubscription,
  syncSubscription,
} from "../sync";
import {
  ics,
  icsResponse,
  installCreateMany,
  seedSubscriptions,
  SECRET_URL_A,
} from "./fixtures";

const NOW = new Date("2026-09-15T12:00:00Z");
const allowAll = async () => undefined;

const FEED_V1 = ics(
  "BEGIN:VEVENT",
  "UID:assembly@school.test",
  "DTSTART;TZID=America/Toronto:20260918T090000",
  "DTEND;TZID=America/Toronto:20260918T100000",
  "SUMMARY:SECRETTITLE assembly",
  "DESCRIPTION:SECRETBODY",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:club@school.test",
  "DTSTART;TZID=America/Toronto:20260921T153000",
  "DTEND;TZID=America/Toronto:20260921T163000",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Robotics club",
  "END:VEVENT",
);

// v2: assembly removed, one club instance retitled.
const FEED_V2 = ics(
  "BEGIN:VEVENT",
  "UID:club@school.test",
  "DTSTART;TZID=America/Toronto:20260921T153000",
  "DTEND;TZID=America/Toronto:20260921T163000",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Robotics club",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:club@school.test",
  "RECURRENCE-ID;TZID=America/Toronto:20260928T153000",
  "DTSTART;TZID=America/Toronto:20260928T160000",
  "DTEND;TZID=America/Toronto:20260928T170000",
  "SUMMARY:Robotics club (late start)",
  "END:VEVENT",
);

const importedA = () =>
  db.rows("event").filter((e) => e.source_subscription_id === "sub-a");
const fetchOnce = (body: string, headers: Record<string, string> = {}) =>
  jest.fn(async () => icsResponse(body, headers));

let logSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  db.reset();
  seedSubscriptions();
  installCreateMany();
  require("@/lib/rate-limit-db").__reset();
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined),
  );
});

afterEach(() => logSpies.forEach((s) => s.mockRestore()));

function loggedText(): string {
  return JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
}

describe("syncSubscription", () => {
  it("imports events once; a second import of the same feed creates no duplicates", async () => {
    const first = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(first).toMatchObject({
      status: "ok",
      created: 4,
      updated: 0,
      deleted: 0,
    });
    const idsAfterFirst = importedA()
      .map((e) => e.id)
      .sort();

    const second = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(second).toMatchObject({
      status: "ok",
      created: 0,
      updated: 0,
      deleted: 0,
    });
    expect(
      importedA()
        .map((e) => e.id)
        .sort(),
    ).toEqual(idsAfterFirst);

    const assembly = importedA().find(
      (e) => e.source_uid === "assembly@school.test",
    )!;
    expect(assembly).toMatchObject({
      family_id: FAMILY_A,
      created_by: "parent-a",
      event_type: "other",
      title: "SECRETTITLE assembly",
    });
    expect(assembly.start_time.toISOString()).toBe("2026-09-18T13:00:00.000Z");

    const sub = db.find("calendarSubscription", "sub-a")!;
    expect(sub).toMatchObject({ last_status: "ok", last_error: null });
    expect(sub.last_fetched_at).toEqual(NOW);
  });

  it("deletes events removed from the feed, updates overrides, and never touches local or foreign events", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    const localBefore = { ...db.find("event", "event-a")! };
    const foreignBefore = { ...db.find("event", "event-imported-b")! };

    const result = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V2),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(result).toMatchObject({
      status: "ok",
      created: 0,
      updated: 1,
      deleted: 1,
    });
    expect(
      importedA().some((e) => e.source_uid === "assembly@school.test"),
    ).toBe(false);
    const moved = importedA().find(
      (e) => e.title === "Robotics club (late start)",
    )!;
    expect(moved.source_occurrence_start.toISOString()).toBe(
      "2026-09-28T19:30:00.000Z",
    );
    expect(moved.start_time.toISOString()).toBe("2026-09-28T20:00:00.000Z");

    expect(db.find("event", "event-a")).toEqual(localBefore);
    expect(db.find("event", "event-imported-b")).toEqual(foreignBefore);
    for (const w of writesTo("event").filter((w) => w.op !== "create")) {
      expect(JSON.stringify(w.args.where)).toContain("sub-a");
    }
  });

  it("an empty (but valid) feed removes this subscription's in-window events only", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    const result = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(ics()),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(result).toMatchObject({ status: "ok", deleted: 4 });
    expect(importedA()).toHaveLength(0);
    expect(db.find("event", "event-a")).toBeDefined();
    expect(db.find("event", "event-imported-b")).toBeDefined();
  });

  it("stores an error status for a malformed feed and keeps previously imported events", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    const later = new Date(NOW.getTime() + 60_000);
    const result = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce("<html>SECRETBODY oops</html>"),
      assertUrl: allowAll,
      now: later,
    });
    expect(result).toMatchObject({
      status: "error",
      error: "Feed is not a valid calendar",
    });
    expect(importedA()).toHaveLength(4);
    expect(db.find("calendarSubscription", "sub-a")).toMatchObject({
      last_status: "error",
      last_error: "Feed is not a valid calendar",
      last_fetched_at: later,
    });
  });

  it("stores an error status for fetch failures (HTTP, SSRF) without the URL", async () => {
    const r1 = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: async () => new Response("nope", { status: 403 }),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(r1).toMatchObject({
      status: "error",
      error: "Feed could not be downloaded (HTTP 403)",
    });

    const r2 = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: jest.fn(),
      assertUrl: async () => {
        throw new Error("The provider URL must be a public address");
      },
      now: NOW,
    });
    expect(r2).toMatchObject({
      status: "error",
      error: "Feed address is not allowed",
    });
    expect(
      JSON.stringify(db.find("calendarSubscription", "sub-a")),
    ).not.toContain("SECRETA");
  });

  it("uses validators and treats 304 as a successful no-op", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1, { etag: '"abc"' }),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(db.find("calendarSubscription", "sub-a")!.etag).toBe('"abc"');
    db.writes = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect((init!.headers as Record<string, string>)["If-None-Match"]).toBe(
        '"abc"',
      );
      return new Response(null, { status: 304 });
    });
    const result = await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl,
      assertUrl: allowAll,
      now: NOW,
    });
    expect(result).toMatchObject({ status: "not_modified" });
    expect(writesTo("event")).toHaveLength(0);
  });

  it("never logs the feed URL or any event content", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce("SECRETBODY garbage"),
      assertUrl: allowAll,
      now: NOW,
    });
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: async () => {
        throw new Error(`connect ECONNREFUSED ${SECRET_URL_A}`);
      },
      assertUrl: allowAll,
      now: NOW,
    });
    const text = loggedText();
    expect(text).toContain("sub-a"); // failures are logged, by id
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toContain("cal.example.com");
    expect(text).not.toContain("Robotics");
  });

  it("returns null and writes nothing for another family's subscription", async () => {
    const fetchImpl = jest.fn();
    expect(
      await syncSubscription("sub-b", FAMILY_A, {
        fetchImpl,
        assertUrl: allowAll,
        now: NOW,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});

describe("removeSubscription", () => {
  it("deletes only that subscription's events, in its own family", async () => {
    await syncSubscription("sub-a", FAMILY_A, {
      fetchImpl: fetchOnce(FEED_V1),
      assertUrl: allowAll,
      now: NOW,
    });
    expect(await removeSubscription(fakePrisma, "sub-b", FAMILY_A)).toBe(0);
    expect(db.find("calendarSubscription", "sub-b")).toBeDefined();
    expect(db.find("event", "event-imported-b")).toBeDefined();

    expect(await removeSubscription(fakePrisma, "sub-a", FAMILY_A)).toBe(4);
    expect(db.find("calendarSubscription", "sub-a")).toBeUndefined();
    expect(importedA()).toHaveLength(0);
    expect(db.find("event", "event-a")).toBeDefined();
  });
});

describe("refreshStaleSubscriptions", () => {
  it("refreshes stale subscriptions once per lease window and only in the given family", async () => {
    const fetchImpl = jest.fn(async () => icsResponse(FEED_V1));
    expect(
      await refreshStaleSubscriptions(FAMILY_A, {
        fetchImpl,
        assertUrl: allowAll,
        now: NOW,
      }),
    ).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.find("calendarSubscription", "sub-b")!.last_status).toBe(
      "pending",
    );

    // Mark stale again: the lease still blocks a stampede.
    db.find("calendarSubscription", "sub-a")!.last_fetched_at = new Date(
      NOW.getTime() - 60 * 60 * 1000,
    );
    expect(
      await refreshStaleSubscriptions(FAMILY_A, {
        fetchImpl,
        assertUrl: allowAll,
        now: NOW,
      }),
    ).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips subscriptions fetched in the last 15 minutes", async () => {
    db.find("calendarSubscription", "sub-a")!.last_fetched_at = new Date(
      NOW.getTime() - 5 * 60 * 1000,
    );
    const fetchImpl = jest.fn();
    expect(
      await refreshStaleSubscriptions(FAMILY_A, {
        fetchImpl,
        assertUrl: allowAll,
        now: NOW,
      }),
    ).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await refreshStaleSubscriptions(FAMILY_B, {
        fetchImpl: jest.fn(async () => icsResponse(ics())),
        assertUrl: allowAll,
        now: NOW,
      }),
    ).toBe(1);
  });
});
