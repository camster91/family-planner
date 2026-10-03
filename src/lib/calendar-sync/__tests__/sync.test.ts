// Two-way sync semantics (#264) against an in-memory provider and the
// two-household fake database: pull, push, deletes both ways, conflicts,
// 410 resync, 429, token refresh, idempotency and household isolation.

jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/rate-limit-db", () => {
  const windows = new Map<string, number>();
  return {
    __reset: () => windows.clear(),
    checkRateLimit: async (key: string, max: number, windowMs: number) => {
      const used = windows.get(key) ?? 0;
      if (used >= max) return { allowed: false, remaining: 0, retryAfterMs: windowMs };
      windows.set(key, used + 1);
      return { allowed: true, remaining: max - used - 1, retryAfterMs: 0 };
    },
  };
});

import {
  db,
  fakePrisma,
  FAMILY_A,
  FAMILY_B,
  FOREIGN,
} from "@/__tests__/helpers/two-household";
import {
  CURSOR_MAX_AGE_MS,
  packCursor,
  usableCursor,
  refreshStaleConnections,
  removeConnection,
  syncConnection,
  changeCalendar,
  type EngineDeps,
} from "../sync";
import { decryptToken, encryptToken, tokenAad } from "../token-crypto";
import { ProviderHttpError } from "../http";
import {
  clearSyncEnv,
  FakeOAuth,
  FakeProvider,
  rateLimited,
  setSyncEnv,
  TEST_CONFIG,
} from "./fakes";

const NOW = new Date();
const HOUR = 3600000;
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400000);

let provider: FakeProvider;
let oauth: FakeOAuth;
let deps: EngineDeps;

function seedConnection(
  id: string,
  familyId: string,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  db.rows("calendarConnection").push({
    id,
    family_id: familyId,
    user_id: userId,
    provider: "google",
    calendar_id: "primary",
    calendar_name: "Home",
    access_token_enc: encryptToken("ACCESS-OK", tokenAad.access(familyId)),
    refresh_token_enc: encryptToken("REFRESH-OK", tokenAad.refresh(familyId)),
    token_expires_at: new Date(NOW.getTime() + HOUR),
    sync_cursor: null,
    push_mode: "linked",
    status: "pending",
    last_synced_at: null,
    last_error: null,
    conflicts_count: 0,
    last_conflict_at: null,
    generation: 0,
    created_at: NOW,
    updated_at: NOW,
    ...extra,
  });
}

const conn = (id = "conn-a") => db.find("calendarConnection", id)!;
const links = (id = "conn-a") =>
  db.rows("calendarEventLink").filter((l) => l.connection_id === id);
const imported = (id = "conn-a") =>
  db.rows("event").filter((e) => e.source_connection_id === id);

beforeAll(() => setSyncEnv());
afterAll(() => clearSyncEnv());

beforeEach(() => {
  db.reset();
  require("@/lib/rate-limit-db").__reset();
  provider = new FakeProvider();
  oauth = new FakeOAuth();
  deps = {
    db: fakePrisma,
    now: NOW,
    adapterFor: () => provider,
    oauthFor: () => oauth,
    configFor: () => TEST_CONFIG,
  };
  seedConnection("conn-a", FAMILY_A, "parent-a");
  seedConnection("conn-b", FAMILY_B, "parent-b");
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("pull", () => {
  it("imports provider events as linked family events, idempotently", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    provider.remoteUpsert("r2", { title: "Piano", start: inDays(3), location: "Studio" });

    const first = await syncConnection("conn-a", FAMILY_A, deps);
    expect(first).toMatchObject({ status: "ok", pulled: { created: 2 } });
    expect(imported()).toHaveLength(2);
    expect(imported().every((e) => e.family_id === FAMILY_A && e.created_by === "parent-a")).toBe(true);
    expect(links().map((l) => l.external_id).sort()).toEqual(["r1", "r2"]);
    expect(conn().sync_cursor).toBe(`c1.${NOW.getTime()}.${provider.seq}`);
    expect(conn().status).toBe("ok");

    // Re-running (incremental and full) creates nothing new.
    const again = await syncConnection("conn-a", FAMILY_A, deps);
    expect(again).toMatchObject({ pulled: { created: 0, updated: 0, deleted: 0 } });
    conn().sync_cursor = null;
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(imported()).toHaveLength(2);
    expect(links()).toHaveLength(2);
  });

  it("applies remote edits and remote deletes", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    provider.remoteUpsert("r2", { title: "Piano", start: inDays(3) });
    await syncConnection("conn-a", FAMILY_A, deps);

    provider.remoteUpsert("r1", { title: "Swim (moved)", start: inDays(4) });
    provider.remoteDelete("r2");
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ pulled: { updated: 1, deleted: 1 } });
    expect(imported().map((e) => e.title)).toEqual(["Swim (moved)"]);
    expect(links()).toHaveLength(1);
  });

  it("410 Gone on the cursor triggers a full resync that removes vanished events", async () => {
    provider.remoteUpsert("r1", { title: "Keep", start: inDays(2) });
    provider.remoteUpsert("r2", { title: "Vanish", start: inDays(3) });
    await syncConnection("conn-a", FAMILY_A, deps);

    // Deleted while our cursor was expired: the delta is lost, only a full listing shows it.
    provider.items.delete("r2");
    provider.minValidCursor = provider.seq + 1;
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "ok", resynced: true, pulled: { deleted: 1, created: 0 } });
    expect(provider.calls.filter((c) => c.startsWith("pull"))).toEqual([
      "pull:full",
      "pull:2", // expired cursor -> 410
      "pull:full",
    ]);
    expect(imported().map((e) => e.title)).toEqual(["Keep"]);
  });

  it("lists the window in full again once the cursor is a week old, so the window moves forward", async () => {
    provider.remoteUpsert("r1", { title: "Soon", start: inDays(2) });
    await syncConnection("conn-a", FAMILY_A, deps);
    // Comes into view only after the window has moved on.
    provider.remoteUpsert("far", { title: "Far", start: inDays(200) });

    const day = 86400000;
    await syncConnection("conn-a", FAMILY_A, { ...deps, now: new Date(NOW.getTime() + day) });
    expect(imported().map((e) => e.title)).toEqual(["Soon"]); // incremental: beyond the window, skipped

    const later = new Date(NOW.getTime() + 30 * day);
    provider.calls = [];
    const res = await syncConnection("conn-a", FAMILY_A, { ...deps, now: later });
    expect(res).toMatchObject({ status: "ok", resynced: false });
    expect(provider.calls.filter((c) => c.startsWith("pull"))).toEqual(["pull:full"]);
    expect(conn().sync_cursor).toBe(`c1.${later.getTime()}.${provider.seq}`);
    expect(imported().map((e) => e.title).sort()).toEqual(["Far", "Soon"]);
    expect(links()).toHaveLength(2);
  });

  it("cursor helpers: old-format, future and expired cursors force a full listing", () => {
    expect(usableCursor(null, NOW)).toBeNull();
    expect(usableCursor("legacy-token", NOW)).toBeNull();
    expect(usableCursor(packCursor("tok.with.dots", NOW), NOW)).toBe("tok.with.dots");
    expect(usableCursor(packCursor("t", NOW), new Date(NOW.getTime() + CURSOR_MAX_AGE_MS + 1))).toBeNull();
    expect(usableCursor(packCursor("t", new Date(NOW.getTime() + 60000)), NOW)).toBeNull();
    expect(packCursor(null, NOW)).toBeNull();
  });

  it("does not import events that ended before the sync window", async () => {
    provider.remoteUpsert("old", { title: "Ancient", start: inDays(-90), end: inDays(-89) });
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(imported()).toHaveLength(0);
  });

  it("re-links an event it pushed itself instead of importing a duplicate", async () => {
    db.rows("event").push({
      id: "local-1", family_id: FAMILY_A, title: "Dinner", description: null, location: null,
      start_time: inDays(1), end_time: new Date(inDays(1).getTime() + HOUR), event_type: "family",
      created_by: "parent-a", source_subscription_id: null, source_connection_id: null, is_task: false,
      created_at: NOW, updated_at: NOW,
    });
    // Provider create succeeded but the link write was lost.
    provider.remoteUpsert("r-own", {
      title: "Dinner", start: inDays(1), end: new Date(inDays(1).getTime() + HOUR),
      marker: { connectionId: "conn-a", eventId: "local-1" },
    });
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(imported()).toHaveLength(0);
    expect(links()).toEqual([expect.objectContaining({ event_id: "local-1", external_id: "r-own" })]);
  });
});

describe("push", () => {
  async function importOne() {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    await syncConnection("conn-a", FAMILY_A, deps);
    return imported()[0];
  }

  it("pushes local edits of a linked event back to the provider", async () => {
    const ev = await importOne();
    ev.title = "Swim lessons";
    ev.updated_at = new Date(NOW.getTime() + 1000);
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ pushed: { updated: 1 }, conflicts: 0 });
    expect(provider.items.get("r1")!.ev.title).toBe("Swim lessons");
    // The echo of our own push is not re-applied or re-pushed.
    provider.calls = [];
    const again = await syncConnection("conn-a", FAMILY_A, deps);
    expect(again).toMatchObject({ pushed: { updated: 0 }, pulled: { updated: 0 } });
    expect(provider.calls.filter((c) => c.startsWith("update"))).toEqual([]);
  });

  it("pushes a local delete (tombstone link) as a provider delete, once", async () => {
    const ev = await importOne();
    // ON DELETE SET NULL on CalendarEventLink.event_id, as Postgres does it.
    db.tables.event = db.rows("event").filter((e) => e.id !== ev.id);
    links()[0].event_id = null;
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ pushed: { deleted: 1 } });
    expect(provider.items.get("r1")!.ev.deleted).toBe(true);
    expect(links()).toHaveLength(0);
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(imported()).toHaveLength(0);
  });

  it("linked mode never pushes unlinked family events; all mode pushes native ones once", async () => {
    db.rows("event").push(
      {
        id: "native-1", family_id: FAMILY_A, title: "Dentist", description: null, location: null,
        start_time: inDays(5), end_time: new Date(inDays(5).getTime() + HOUR), event_type: "appointment",
        created_by: "parent-a", source_subscription_id: null, source_connection_id: null, is_task: false,
        created_at: NOW, updated_at: NOW,
      },
      {
        id: "ics-1", family_id: FAMILY_A, title: "School assembly", description: null, location: null,
        start_time: inDays(6), end_time: new Date(inDays(6).getTime() + HOUR), event_type: "other",
        created_by: "parent-a", source_subscription_id: "sub-a", source_connection_id: null, is_task: false,
        created_at: NOW, updated_at: NOW,
      },
    );
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(provider.calls).not.toContain("create");

    conn().push_mode = "all";
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    // Native family-A events only (the seeded "Home dentist" and "Dentist");
    // never the subscribed (ICS) one, never family B's.
    expect(res).toMatchObject({ pushed: { created: 2 } });
    expect(provider.live().map((e) => e.title).sort()).toEqual(["Dentist", "Home dentist"]);
    expect(links().map((l) => l.event_id).sort()).toEqual(["event-a", "native-1"]);

    // Idempotent: the pushed copies are not imported back and not pushed again.
    await syncConnection("conn-a", FAMILY_A, deps);
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(provider.live()).toHaveLength(2);
    expect(imported()).toHaveLength(0);
    expect(db.rows("event").filter((e) => e.title === "Dentist")).toHaveLength(1);
  });

  it("a remote delete of a pushed local event deletes it locally too", async () => {
    conn().push_mode = "all";
    db.rows("event").push({
      id: "native-1", family_id: FAMILY_A, title: "Dentist", description: null, location: null,
      start_time: inDays(5), end_time: new Date(inDays(5).getTime() + HOUR), event_type: "appointment",
      created_by: "parent-a", source_subscription_id: null, source_connection_id: null, is_task: false,
      created_at: NOW, updated_at: NOW,
    });
    await syncConnection("conn-a", FAMILY_A, deps);
    provider.remoteDelete(provider.live().find((e) => e.marker?.eventId === "native-1")!.id);
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(db.find("event", "native-1")).toBeUndefined();
  });
});

describe("conflicts (last writer wins)", () => {
  async function importOne() {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) }, new Date(NOW.getTime() - HOUR));
    await syncConnection("conn-a", FAMILY_A, deps);
    return imported()[0];
  }

  it("remote wins when the provider change is newer", async () => {
    const ev = await importOne();
    ev.title = "Local title";
    ev.updated_at = new Date(NOW.getTime() - 30 * 60000);
    provider.remoteUpsert("r1", { title: "Remote title" }, new Date(NOW.getTime() - 60000));
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ conflicts: 1, pushed: { updated: 0 } });
    expect(ev.title).toBe("Remote title");
    expect(conn().conflicts_count).toBe(1);
    expect(conn().last_conflict_at).toEqual(NOW);
  });

  it("local wins when the local edit is newer, and is pushed", async () => {
    const ev = await importOne();
    provider.remoteUpsert("r1", { title: "Remote title" }, new Date(NOW.getTime() - 30 * 60000));
    ev.title = "Local title";
    ev.updated_at = new Date(NOW.getTime() - 60000);
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ conflicts: 1, pushed: { updated: 1 } });
    expect(ev.title).toBe("Local title");
    expect(provider.items.get("r1")!.ev.title).toBe("Local title");
  });

  it("conflict records are content-minimal (count + time only)", async () => {
    const ev = await importOne();
    ev.title = "Secret local title";
    ev.updated_at = new Date(NOW.getTime() + 1);
    provider.remoteUpsert("r1", { title: "Secret remote title" }, new Date(NOW.getTime() - 1));
    const warn = jest.spyOn(console, "warn");
    await syncConnection("conn-a", FAMILY_A, deps);
    const stored = JSON.stringify(conn());
    expect(stored).not.toContain("Secret");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Secret");
  });
});

describe("errors, tokens and rate limits", () => {
  it("records a rate-limit error without touching events", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    provider.failNext = rateLimited();
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "error" });
    expect(res!.error).toMatch(/busy/);
    expect(conn().status).toBe("error");
    expect(imported()).toHaveLength(0);
    // Next run recovers.
    expect(await syncConnection("conn-a", FAMILY_A, deps)).toMatchObject({ status: "ok", pulled: { created: 1 } });
    expect(conn().last_error).toBeNull();
  });

  it("refreshes an expired access token and stores it encrypted", async () => {
    conn().token_expires_at = new Date(NOW.getTime() - 1000);
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(oauth.refreshCalls).toBe(1);
    expect(conn().access_token_enc).not.toContain("ACCESS-REFRESHED");
    expect(decryptToken(conn().access_token_enc, tokenAad.access(FAMILY_A))).toBe("ACCESS-REFRESHED-1");
  });

  it("re-encrypts an unchanged refresh token with the new key during a key rotation", async () => {
    const oldKey = process.env.CALENDAR_TOKEN_KEY!;
    const newKey = require("crypto").randomBytes(32).toString("base64");
    process.env.CALENDAR_TOKEN_KEY = newKey;
    process.env.CALENDAR_TOKEN_KEY_PREVIOUS = oldKey;
    try {
      const before = conn().refresh_token_enc;
      conn().token_expires_at = new Date(NOW.getTime() - 1000);
      expect(await syncConnection("conn-a", FAMILY_A, deps)).toMatchObject({ status: "ok" });
      expect(conn().refresh_token_enc).not.toBe(before);
      delete process.env.CALENDAR_TOKEN_KEY_PREVIOUS;
      expect(decryptToken(conn().refresh_token_enc, tokenAad.refresh(FAMILY_A))).toBe("REFRESH-OK");
    } finally {
      process.env.CALENDAR_TOKEN_KEY = oldKey;
      delete process.env.CALENDAR_TOKEN_KEY_PREVIOUS;
    }
  });

  it("revokes a token refreshed while the connection was deleted (account or household deletion)", async () => {
    conn().token_expires_at = new Date(NOW.getTime() - 1000);
    const realRefresh = oauth.refresh.bind(oauth);
    jest.spyOn(oauth, "refresh").mockImplementation(async () => {
      const set = await realRefresh();
      // The deletion commits while the provider call is in flight.
      const rows = db.rows("calendarConnection");
      rows.splice(rows.findIndex((c) => c.id === "conn-a"), 1);
      return set;
    });
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res?.status).not.toBe("ok");
    // The just-issued token has no row to live in, so it is revoked.
    expect(oauth.revoked).toEqual(["ACCESS-REFRESHED-1"]);
    expect(db.find("calendarConnection", "conn-a")).toBeUndefined();
  });

  it("marks reauth_required when the refresh token is revoked", async () => {
    conn().token_expires_at = new Date(NOW.getTime() - 1000);
    oauth.grantRevoked = true;
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "reauth_required" });
    expect(conn().status).toBe("reauth_required");
    expect(conn().access_token_enc).toBeNull();
  });

  it("a missing scope (403 insufficientPermissions) asks the member to reconnect, not to pick another calendar", async () => {
    provider.failNext = new ProviderHttpError("insufficient_scope", 403);
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "reauth_required" });
    expect(conn().status).toBe("reauth_required");
    expect(conn().last_error).toMatch(/^Reconnect this calendar/);
  });

  it("a Google 403 rate limit is reported as busy, not as a lost calendar", async () => {
    provider.failNext = new ProviderHttpError("rate_limited", 403);
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "error" });
    expect(conn().last_error).toMatch(/busy/);
  });

  it("does nothing until a calendar is chosen", async () => {
    conn().calendar_id = null;
    expect(await syncConnection("conn-a", FAMILY_A, deps)).toMatchObject({ status: "not_ready" });
    expect(provider.calls).toEqual([]);
  });

  it("is dormant when the provider is not configured", async () => {
    const res = await syncConnection("conn-a", FAMILY_A, { ...deps, configFor: () => null });
    expect(res).toMatchObject({ status: "error" });
    expect(provider.calls).toEqual([]);
  });
});

describe("household isolation", () => {
  it("a connection is only reachable through its own household", async () => {
    expect(await syncConnection("conn-b", FAMILY_A, deps)).toBeNull();
    expect(await removeConnection("conn-b", FAMILY_A, deps)).toBeNull();
    expect(db.find("calendarConnection", "conn-b")).toBeDefined();
  });

  it("syncing family A never reads or writes family B events or links", async () => {
    db.rows("event").push({
      id: "b-linked", family_id: FAMILY_B, title: `${FOREIGN} match`, description: null, location: null,
      start_time: inDays(2), end_time: inDays(2), event_type: "other", created_by: "parent-b",
      source_subscription_id: null, source_connection_id: "conn-b", is_task: false, created_at: NOW, updated_at: NOW,
    });
    db.rows("calendarEventLink").push({
      id: "link-b", family_id: FAMILY_B, connection_id: "conn-b", event_id: "b-linked",
      external_id: "r1", external_etag: '"x"', synced_hash: "h", all_day: false,
    });
    conn().push_mode = "all";
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    await syncConnection("conn-a", FAMILY_A, deps);
    await syncConnection("conn-a", FAMILY_A, deps);
    expect(db.find("event", "b-linked")!.title).toBe(`${FOREIGN} match`);
    expect(db.find("calendarEventLink", "link-b")).toMatchObject({ event_id: "b-linked", synced_hash: "h" });
    expect(provider.live().some((e) => e.title.includes(FOREIGN))).toBe(false);
    expect(db.rows("event").filter((e) => e.family_id === FAMILY_A && e.title.includes(FOREIGN))).toEqual([]);
  });
});

describe("disconnect and calendar change", () => {
  it("revokes, then deletes tokens, links and imported events; local events stay", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    await syncConnection("conn-a", FAMILY_A, deps);
    const localBefore = db.rows("event").filter((e) => e.family_id === FAMILY_A && !e.source_connection_id).length;
    const res = await removeConnection("conn-a", FAMILY_A, deps);
    expect(res).toEqual({ removedEvents: 1 });
    expect(oauth.revoked).toEqual(["REFRESH-OK"]);
    expect(db.find("calendarConnection", "conn-a")).toBeUndefined();
    expect(links()).toHaveLength(0);
    expect(imported()).toHaveLength(0);
    expect(db.rows("event").filter((e) => e.family_id === FAMILY_A).length).toBe(localBefore);
  });

  it("still disconnects when revocation fails", async () => {
    oauth.revoke = async () => {
      throw new Error("network down");
    };
    expect(await removeConnection("conn-a", FAMILY_A, deps)).toEqual({ removedEvents: 0 });
    expect(db.find("calendarConnection", "conn-a")).toBeUndefined();
  });

  it("changing calendar clears the old calendar's events and cursor", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    await syncConnection("conn-a", FAMILY_A, deps);
    await changeCalendar(fakePrisma, "conn-a", FAMILY_A, { id: "work", name: "Work" });
    expect(imported()).toHaveLength(0);
    expect(conn()).toMatchObject({ calendar_id: "work", sync_cursor: null, status: "pending" });
  });
});

describe("review fixes", () => {
  it("push_mode all makes progress past the first page when more events are eligible than one query returns", async () => {
    conn().push_mode = "all";
    const TOTAL = 650; // > the old fixed 500-row candidate page
    for (let i = 0; i < TOTAL; i++) {
      db.rows("event").push({
        id: `bulk-${String(i).padStart(4, "0")}`, family_id: FAMILY_A, title: `Bulk ${i}`, description: null,
        location: null, start_time: new Date(inDays(1).getTime() + i * 60000),
        end_time: new Date(inDays(1).getTime() + i * 60000 + 1800000), event_type: "other", created_by: "parent-a",
        source_subscription_id: null, source_connection_id: null, is_task: false, created_at: NOW, updated_at: NOW,
      });
    }
    const eligible = TOTAL + 1; // plus the seeded native "Home dentist"
    let runs = 0;
    let previous = -1;
    while (links().length < eligible && runs < 20) {
      await syncConnection("conn-a", FAMILY_A, deps);
      runs++;
      expect(links().length).toBeGreaterThan(previous); // progress on every run
      previous = links().length;
    }
    expect(links()).toHaveLength(eligible);
    expect(runs).toBe(Math.ceil(eligible / 100));
    expect(provider.live()).toHaveLength(eligible);
  });

  it("a calendar change during a sync: the stale run imports nothing and never restores the old cursor", async () => {
    provider.remoteUpsert("r1", { title: "Old calendar event", start: inDays(2) });
    const realPull = provider.pull.bind(provider);
    provider.pull = async (...args: Parameters<FakeProvider["pull"]>) => {
      const res = await realPull(...args);
      // The member switches calendars while this run is between pull and apply.
      await changeCalendar(fakePrisma, "conn-a", FAMILY_A, { id: "work", name: "Work" });
      return res;
    };
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res).toMatchObject({ status: "superseded", pulled: { created: 0 } });
    expect(imported()).toHaveLength(0);
    expect(links()).toHaveLength(0);
    expect(conn()).toMatchObject({ calendar_id: "work", sync_cursor: null, status: "pending", generation: 1 });
    expect(conn().last_synced_at).toBeNull();
  });

  it("a calendar change after the cursor was saved: pushed links and final status are not written for the old calendar", async () => {
    conn().push_mode = "all";
    const realCreate = provider.create.bind(provider);
    let switched = false;
    provider.create = async (...args: Parameters<FakeProvider["create"]>) => {
      const res = await realCreate(...args);
      if (!switched) {
        switched = true;
        await changeCalendar(fakePrisma, "conn-a", FAMILY_A, { id: "work", name: "Work" });
      }
      return res;
    };
    const res = await syncConnection("conn-a", FAMILY_A, deps);
    expect(res!.status).toBe("superseded");
    expect(links()).toHaveLength(0);
    expect(conn()).toMatchObject({ calendar_id: "work", sync_cursor: null, status: "pending" });
  });

  it("a removed connection mid-run stops without recreating rows", async () => {
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    const realPull = provider.pull.bind(provider);
    provider.pull = async (...args: Parameters<FakeProvider["pull"]>) => {
      const res = await realPull(...args);
      await removeConnection("conn-a", FAMILY_A, deps);
      return res;
    };
    expect(await syncConnection("conn-a", FAMILY_A, deps)).toMatchObject({ status: "superseded" });
    expect(imported()).toHaveLength(0);
    expect(db.rows("calendarEventLink").filter((l) => l.connection_id === "conn-a")).toHaveLength(0);
  });
});

describe("opportunistic sync", () => {
  it("syncs stale ready connections at most once per lease window", async () => {
    expect(await refreshStaleConnections(FAMILY_A, deps)).toBe(1);
    expect(conn().last_synced_at).toEqual(NOW);
    conn().last_synced_at = new Date(NOW.getTime() - 10 * 60000);
    // Lease still held: no second sync inside the 5-minute window.
    expect(await refreshStaleConnections(FAMILY_A, deps)).toBe(0);
  });

  it("skips fresh, unconfigured and reauth-required connections", async () => {
    conn().last_synced_at = new Date(NOW.getTime() - 60000);
    expect(await refreshStaleConnections(FAMILY_A, deps)).toBe(0);
    conn().last_synced_at = null;
    conn().status = "reauth_required";
    expect(await refreshStaleConnections(FAMILY_A, deps)).toBe(0);
    conn().status = "ok";
    expect(await refreshStaleConnections(FAMILY_A, { ...deps, configFor: () => null })).toBe(0);
  });
});
