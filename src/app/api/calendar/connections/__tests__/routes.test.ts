// Calendar sync routes (#264): kill switch, roles, OAuth callback state
// checks, token secrecy and two-household isolation. Provider adapters and
// OAuth are fakes; nothing reaches Google or Microsoft.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);
jest.mock("@/lib/calendar-sync/providers", () => {
  const fakes = require("@/lib/calendar-sync/__tests__/fakes");
  const state = { provider: new fakes.FakeProvider(), oauth: new fakes.FakeOAuth() };
  return {
    __state: state,
    adapterFor: () => state.provider,
    oauthFor: () => state.oauth,
  };
});

import * as list from "../route";
import * as start from "../[provider]/start/route";
import * as callback from "../[provider]/callback/route";
import * as item from "../../sync-connections/[id]/route";
import * as calendars from "../../sync-connections/[id]/calendars/route";
import * as syncNow from "../../sync-connections/[id]/sync/route";
import {
  db,
  req,
  params,
  bodyOf,
  expectNoForeignData,
  FAMILY_A,
  FAMILY_B,
  FOREIGN,
  type UserKey,
} from "@/__tests__/helpers/two-household";
import { encryptToken, tokenAad } from "@/lib/calendar-sync/token-crypto";
import { clearSyncEnv, FakeOAuth, FakeProvider, setSyncEnv } from "@/lib/calendar-sync/__tests__/fakes";

const providerState = require("@/lib/calendar-sync/providers").__state as {
  provider: FakeProvider;
  oauth: FakeOAuth;
};

const HOUR = 3600000;

function seedConnection(id: string, familyId: string, userId: string, calendarName: string) {
  db.rows("calendarConnection").push({
    id, family_id: familyId, user_id: userId, provider: "google",
    calendar_id: "primary", calendar_name: calendarName,
    access_token_enc: encryptToken(`ACCESS-${id}`, tokenAad.access(familyId)),
    refresh_token_enc: encryptToken(`REFRESH-${id}`, tokenAad.refresh(familyId)),
    token_expires_at: new Date(Date.now() + HOUR), sync_cursor: `CURSOR-${id}`,
    push_mode: "linked", status: "ok", last_synced_at: null, last_error: null,
    conflicts_count: 0, last_conflict_at: null, created_at: new Date(), updated_at: new Date(),
  });
}

const connParams = (id: string) => params({ id });
const providerParams = (provider: string) => params({ provider });

async function startFlow(as: UserKey = "parentA", provider = "google") {
  const res = await start.POST(req({ as, method: "POST" }), providerParams(provider));
  const body = await bodyOf(res);
  const state = body?.authorize_url ? new URL(body.authorize_url).searchParams.get("state") : null;
  return { res, body, state };
}

function callbackReq(as: UserKey | null, query: Record<string, string>, provider = "google") {
  return callback.GET(
    req({ as, path: `/api/calendar/connections/${provider}/callback`, query }),
    providerParams(provider),
  );
}

beforeEach(() => {
  db.reset();
  setSyncEnv();
  providerState.provider = new FakeProvider();
  providerState.oauth = new FakeOAuth();
  seedConnection("conn-a", FAMILY_A, "parent-a", "Home");
  seedConnection("conn-b", FAMILY_B, "parent-b", `${FOREIGN} calendar`);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  clearSyncEnv();
  jest.restoreAllMocks();
});

async function everyHandler(as: UserKey | null) {
  return [
    await list.GET(req({ as })),
    await start.POST(req({ as, method: "POST" }), providerParams("google")),
    await callbackReq(as, { code: "c", state: "s" }),
    await item.PATCH(req({ as, method: "PATCH", body: { push_mode: "all" } }), connParams("conn-a")),
    await item.DELETE(req({ as, method: "DELETE" }), connParams("conn-a")),
    await calendars.GET(req({ as }), connParams("conn-a")),
    await syncNow.POST(req({ as, method: "POST" }), connParams("conn-a")),
  ];
}

describe("kill switch", () => {
  it.each([
    ["nothing configured", SYNC_ALL_OFF()],
    ["no token key", { CALENDAR_TOKEN_KEY: undefined }],
    ["token key of the wrong length", { CALENDAR_TOKEN_KEY: Buffer.alloc(16).toString("base64") }],
    ["no app URL", { APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }],
    ["plain-http public app URL", { APP_URL: "http://family.example.test" }],
    ["no provider secrets", { GOOGLE_CLIENT_SECRET: undefined, MICROSOFT_CLIENT_SECRET: undefined }],
  ])("every route is 404 for a parent when %s, and nothing is written", async (_label, env) => {
    clearSyncEnv();
    setSyncEnv(env as Record<string, string | undefined>);
    for (const res of await everyHandler("parentA")) expect(res.status).toBe(404);
    expect(db.writes).toEqual([]);
  });

  it("a single unconfigured provider is 404 while the other works", async () => {
    setSyncEnv({ MICROSOFT_TENANT: undefined });
    const body = await bodyOf(await list.GET(req({ as: "parentA" })));
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(["google"]);
    expect((await startFlow("parentA", "microsoft")).res.status).toBe(404);
    expect((await startFlow("parentA", "google")).res.status).toBe(200);
    expect((await startFlow("parentA", "yahoo")).res.status).toBe(404);
  });
});

function SYNC_ALL_OFF() {
  return {
    CALENDAR_TOKEN_KEY: undefined,
    APP_URL: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    MICROSOFT_CLIENT_ID: undefined,
    MICROSOFT_CLIENT_SECRET: undefined,
    MICROSOFT_TENANT: undefined,
  };
}

describe("auth and roles", () => {
  it("401 without a session", async () => {
    for (const res of await everyHandler(null)) expect(res.status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s gets 403 on every management route", async (who) => {
    const [l, s, , p, d, c, n] = await everyHandler(who);
    for (const res of [l, s, p, d, c, n]) expect(res.status).toBe(403);
    expect(db.find("calendarConnection", "conn-a")).toBeDefined();
    expect(db.writes).toEqual([]);
  });
});

describe("listing", () => {
  it("returns providers and own-household connections without tokens or cursors", async () => {
    const res = await list.GET(req({ as: "parentA" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await expectNoForeignData(res);
    expect(body.providers).toEqual([
      { id: "google", label: "Google Calendar" },
      { id: "microsoft", label: "Outlook / Microsoft 365" },
    ]);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ id: "conn-a", calendar_name: "Home", is_mine: true });
    const text = JSON.stringify(body);
    for (const secret of ["ACCESS-", "REFRESH-", "CURSOR-", "ct1."]) expect(text).not.toContain(secret);
  });
});

describe("OAuth start + callback", () => {
  it("start returns the provider URL with a state; callback stores encrypted tokens once", async () => {
    db.tables.calendarConnection = db.rows("calendarConnection").filter((c) => c.id !== "conn-a");
    const { res, state } = await startFlow();
    expect(res.status).toBe(200);
    expect(state).toBeTruthy();

    const cb = await callbackReq("parentA", { code: "the-code", state: state! });
    expect(cb.status).toBe(303);
    expect(cb.headers.get("location")).toBe(
      "https://family.example.test/dashboard/settings?calendar_sync=connected#calendar-sync",
    );
    expect(cb.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(providerState.oauth.exchanged).toHaveLength(1);
    const created = db.rows("calendarConnection").find((c) => c.family_id === FAMILY_A)!;
    expect(created).toMatchObject({ user_id: "parent-a", provider: "google", status: "pending" });
    expect(created.access_token_enc).not.toContain("ACCESS-FROM-CODE");
    expect(created.refresh_token_enc).not.toContain("REFRESH-FROM-CODE");

    // Replay of the same state is refused and exchanges nothing.
    const replay = await callbackReq("parentA", { code: "the-code", state: state! });
    expect(replay.headers.get("location")).toContain("calendar_sync=state");
    expect(providerState.oauth.exchanged).toHaveLength(1);
  });

  it("a state started by another member, or another household, is refused", async () => {
    const { state } = await startFlow("parentA");
    const other = await callbackReq("parentB", { code: "c", state: state! });
    expect(other.headers.get("location")).toContain("calendar_sync=state");
    expect(providerState.oauth.exchanged).toHaveLength(0);
    expect(db.rows("calendarConnection").filter((c) => c.family_id === FAMILY_B)).toHaveLength(1);
  });

  it("a state for one provider cannot complete another provider's callback", async () => {
    const { state } = await startFlow("parentA", "google");
    const cb = await callbackReq("parentA", { code: "c", state: state! }, "microsoft");
    expect(cb.headers.get("location")).toContain("calendar_sync=state");
  });

  it("an expired state is refused", async () => {
    const { state } = await startFlow();
    for (const row of db.rows("calendarOAuthState")) row.expires_at = new Date(Date.now() - 1000);
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=state");
    expect(providerState.oauth.exchanged).toHaveLength(0);
  });

  it("a provider error (user denied) burns the state and connects nothing", async () => {
    const { state } = await startFlow();
    const cb = await callbackReq("parentA", { error: "access_denied", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=denied");
    expect(providerState.oauth.exchanged).toHaveLength(0);
  });

  it("reconnecting updates the same connection and resets the cursor", async () => {
    const { state } = await startFlow();
    await callbackReq("parentA", { code: "c", state: state! });
    const rows = db.rows("calendarConnection").filter((c) => c.family_id === FAMILY_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "conn-a", sync_cursor: null, calendar_id: "primary" });
  });

  it("the household limit is enforced when the callback commits, not only at start", async () => {
    db.tables.calendarConnection = db.rows("calendarConnection").filter((c) => c.id !== "conn-a");
    for (let i = 0; i < 5; i++) seedConnection(`other-${i}`, FAMILY_A, `member-${i}`, `Cal ${i}`);
    // Start passes (5 of 6 used)...
    const { res, state } = await startFlow("parentA");
    expect(res.status).toBe(200);
    // ...then a parallel flow commits the 6th connection first.
    seedConnection("raced", FAMILY_A, "member-raced", "Raced");
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=limit");
    expect(db.rows("calendarConnection").filter((c) => c.family_id === FAMILY_A)).toHaveLength(6);
    expect(db.rows("calendarConnection").some((c) => c.user_id === "parent-a")).toBe(false);
    // The unused grant is revoked (best effort).
    expect(providerState.oauth.revoked).toEqual(["REFRESH-FROM-CODE"]);
  });

  // D-3: a deletion that commits between the token exchange and the commit.
  it("a callback whose household was deleted after the code exchange stores nothing and revokes the new grant", async () => {
    db.tables.calendarConnection = db.rows("calendarConnection").filter((c) => c.id !== "conn-a");
    const { state } = await startFlow("parentA");
    const exchange = providerState.oauth.exchangeCode.bind(providerState.oauth);
    providerState.oauth.exchangeCode = async (...args: Parameters<FakeOAuth["exchangeCode"]>) => {
      const tokens = await exchange(...args);
      // The household is deleted while the provider round trip was in flight.
      db.tables.family = db.rows("family").filter((f) => f.id !== FAMILY_A);
      return tokens;
    };
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=forbidden");
    expect(db.rows("calendarConnection").filter((c) => c.family_id === FAMILY_A)).toHaveLength(0);
    expect(providerState.oauth.revoked).toEqual(["REFRESH-FROM-CODE"]);
  });

  it("a callback whose member left or was deleted after the exchange is refused and revoked", async () => {
    db.tables.calendarConnection = db.rows("calendarConnection").filter((c) => c.id !== "conn-a");
    const { state } = await startFlow("parentA");
    const exchange = providerState.oauth.exchangeCode.bind(providerState.oauth);
    providerState.oauth.exchangeCode = async (...args: Parameters<FakeOAuth["exchangeCode"]>) => {
      const tokens = await exchange(...args);
      db.find("user", "parent-a")!.family_id = null;
      return tokens;
    };
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=forbidden");
    expect(db.rows("calendarConnection").some((c) => c.user_id === "parent-a")).toBe(false);
    expect(providerState.oauth.revoked).toEqual(["REFRESH-FROM-CODE"]);
  });

  it("a commit that throws after the exchange still revokes the new grant", async () => {
    const connections = require("@/lib/calendar-sync/connections");
    const spy = jest.spyOn(connections, "commitConnection").mockRejectedValueOnce(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { state } = await startFlow("parentA");
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=error");
    expect(providerState.oauth.revoked).toEqual(["REFRESH-FROM-CODE"]);
    spy.mockRestore();
  });

  it("re-connecting an existing member+provider is an update even at the limit, and bumps the generation", async () => {
    for (let i = 0; i < 5; i++) seedConnection(`other-${i}`, FAMILY_A, `member-${i}`, `Cal ${i}`);
    db.find("calendarConnection", "conn-a")!.generation = 3;
    const { state } = await startFlow("parentA");
    const cb = await callbackReq("parentA", { code: "c", state: state! });
    expect(cb.headers.get("location")).toContain("calendar_sync=connected");
    expect(db.rows("calendarConnection").filter((c) => c.family_id === FAMILY_A)).toHaveLength(6);
    expect(db.find("calendarConnection", "conn-a")).toMatchObject({ generation: 4, sync_cursor: null });
  });

  it("the list never hides a live connection", async () => {
    // e.g. rows created before the commit-time cap existed
    for (let i = 0; i < 7; i++) seedConnection(`legacy-${i}`, FAMILY_A, `member-${i}`, `Cal ${i}`);
    const body = await bodyOf(await list.GET(req({ as: "parentA" })));
    expect(body.connections).toHaveLength(8);
  });

  it("a teen reaching the callback is redirected without a connection", async () => {
    const res = await callbackReq("teenA", { code: "c", state: "s" });
    expect(res.headers.get("location")).toContain("calendar_sync=forbidden");
  });
});

describe("per-connection routes: household isolation and ownership", () => {
  it.each<[string, () => Promise<any>]>([
    ["PATCH", () => item.PATCH(req({ as: "parentA", method: "PATCH", body: { push_mode: "all" } }), connParams("conn-b"))],
    ["DELETE", () => item.DELETE(req({ as: "parentA", method: "DELETE" }), connParams("conn-b"))],
    ["GET calendars", () => calendars.GET(req({ as: "parentA" }), connParams("conn-b"))],
    ["POST sync", () => syncNow.POST(req({ as: "parentA", method: "POST" }), connParams("conn-b"))],
  ])("%s on another household's connection is 404 and changes nothing", async (_l, call) => {
    const res = await call();
    expect(res.status).toBe(404);
    const text = JSON.stringify(await bodyOf(res));
    expect(text).not.toContain(FOREIGN);
    expect(db.find("calendarConnection", "conn-b")).toMatchObject({ push_mode: "linked" });
    expect(db.writes.filter((w) => w.model === "calendarConnection")).toEqual([]);
    expect(providerState.provider.calls).toEqual([]);
  });

  it("another parent in the household can sync and disconnect but not reconfigure or list calendars", async () => {
    db.rows("user").push({ ...db.find("user", "parent-a")!, id: "parent-a2", email: "a2@example.test", name: "Parent A2" });
    const asA2 = (opts: any) => {
      const r = req({ as: "parentA", ...opts });
      r.cookies = { get: (n: string) => (n === "session_token" ? { value: "session:parent-a2" } : undefined) };
      return r;
    };
    expect((await item.PATCH(asA2({ method: "PATCH", body: { push_mode: "all" } }), connParams("conn-a"))).status).toBe(403);
    expect((await calendars.GET(asA2({}), connParams("conn-a"))).status).toBe(403);
    expect((await syncNow.POST(asA2({ method: "POST" }), connParams("conn-a"))).status).toBe(200);
    expect((await item.DELETE(asA2({ method: "DELETE" }), connParams("conn-a"))).status).toBe(200);
    expect(db.find("calendarConnection", "conn-a")).toBeUndefined();
  });

  it("the owner can pick a writable calendar and switch push mode", async () => {
    const cals = await calendars.GET(req({ as: "parentA" }), connParams("conn-a"));
    expect((await bodyOf(cals)).calendars).toEqual([{ id: "primary", name: "Home", primary: true }]);

    const bad = await item.PATCH(req({ as: "parentA", method: "PATCH", body: { calendar_id: "readonly" } }), connParams("conn-a"));
    expect(bad.status).toBe(400);
    const pm = await item.PATCH(req({ as: "parentA", method: "PATCH", body: { push_mode: "all" } }), connParams("conn-a"));
    expect(pm.status).toBe(200);
    expect((await bodyOf(pm)).connection).toMatchObject({ push_mode: "all" });
    const invalid = await item.PATCH(req({ as: "parentA", method: "PATCH", body: { push_mode: "everything" } }), connParams("conn-a"));
    expect(invalid.status).toBe(400);
  });

  it("sync now returns counts and status, never tokens", async () => {
    providerState.provider.remoteUpsert("r1", { title: "Swim", start: new Date(Date.now() + 86400000) });
    const res = await syncNow.POST(req({ as: "parentA", method: "POST" }), connParams("conn-a"));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.result).toMatchObject({ status: "ok", pulled: { created: 1 } });
    const text = JSON.stringify(body);
    for (const secret of ["ACCESS-", "REFRESH-", "ct1."]) expect(text).not.toContain(secret);
  });

  it("disconnect revokes and removes only this household's imported events", async () => {
    db.rows("event").push({ id: "imp-b", family_id: FAMILY_B, title: `${FOREIGN} x`, start_time: new Date(), end_time: new Date(), source_connection_id: "conn-b", created_by: "parent-b" });
    db.rows("event").push({ id: "imp-a", family_id: FAMILY_A, title: "x", start_time: new Date(), end_time: new Date(), source_connection_id: "conn-a", created_by: "parent-a" });
    const res = await item.DELETE(req({ as: "parentA", method: "DELETE" }), connParams("conn-a"));
    expect(await bodyOf(res)).toEqual({ success: true, removed_events: 1 });
    expect(providerState.oauth.revoked).toEqual(["REFRESH-conn-a"]);
    expect(db.find("event", "imp-b")).toBeDefined();
    expect(db.find("calendarConnection", "conn-b")).toBeDefined();
  });
});
