// Google and Microsoft adapters (#264) against recorded-shape fake responses.
// fetch is a jest mock: nothing here reaches Google or Microsoft.

import { createGoogleAdapter, createGoogleOAuth, GOOGLE_SCOPES } from "../google";
import {
  assertGraphLink,
  createMicrosoftAdapter,
  createMicrosoftOAuth,
  transactionIdFor,
} from "../microsoft";
import { CursorExpiredError, OAuthGrantError, type EventInput } from "../types";
import type { ProviderConfig } from "../config";

const TZ = "America/Toronto";
const WINDOW = {
  start: new Date("2026-09-01T00:00:00Z"),
  end: new Date("2027-03-01T00:00:00Z"),
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function scripted(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  return { fetchImpl, calls, sleep: async () => undefined };
}

const INPUT: EventInput = {
  title: "Dentist",
  description: null,
  location: "Clinic",
  start: new Date("2026-10-05T14:00:00Z"),
  end: new Date("2026-10-05T15:00:00Z"),
  allDay: false,
  timeZone: TZ,
  marker: { connectionId: "conn1", eventId: "evt1" },
};

describe("Google adapter", () => {
  it("pages a full listing and returns the sync token; maps cancelled and all-day", async () => {
    const http = scripted([
      json({
        items: [
          {
            id: "a", status: "confirmed", summary: "Swim", etag: '"1"', updated: "2026-09-20T10:00:00Z",
            start: { dateTime: "2026-10-01T17:00:00-04:00" }, end: { dateTime: "2026-10-01T18:00:00-04:00" },
          },
        ],
        nextPageToken: "p2",
      }),
      json({
        items: [
          { id: "b", status: "confirmed", summary: "Holiday", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
          { id: "c", status: "cancelled" },
        ],
        nextSyncToken: "sync-1",
      }),
    ]);
    const res = await createGoogleAdapter(http).pull("tok", "primary", null, WINDOW, TZ);
    expect(res.full).toBe(true);
    expect(res.nextCursor).toBe("sync-1");
    expect(res.events.map((e) => [e.id, e.deleted])).toEqual([["a", false], ["b", false], ["c", true]]);
    expect(res.events[0].start.toISOString()).toBe("2026-10-01T21:00:00.000Z");
    expect(res.events[1]).toMatchObject({ allDay: true });
    expect(res.events[1].start.toISOString()).toBe("2026-10-12T04:00:00.000Z"); // Toronto midnight (EDT)
    const first = new URL(http.calls[0].url);
    expect(first.hostname).toBe("www.googleapis.com");
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("timeMin")).toBe(WINDOW.start.toISOString());
    expect(new URL(http.calls[1].url).searchParams.get("pageToken")).toBe("p2");
    expect(http.calls[0].init.headers).toMatchObject({ authorization: "Bearer tok" });
  });

  it("uses the sync token incrementally and turns 410 into a full-resync signal", async () => {
    const http = scripted([json({ error: "gone" }, 410)]);
    await expect(
      createGoogleAdapter(http).pull("tok", "primary", "old-token", WINDOW, TZ),
    ).rejects.toBeInstanceOf(CursorExpiredError);
    const url = new URL(http.calls[0].url);
    expect(url.searchParams.get("syncToken")).toBe("old-token");
    expect(url.searchParams.get("timeMin")).toBeNull();
  });

  it("retries a 429 and honours Retry-After", async () => {
    const sleep = jest.fn(async () => undefined);
    const http = scripted([
      json({}, 429, { "retry-after": "1" }),
      json({ items: [], nextSyncToken: "s" }),
    ]);
    const res = await createGoogleAdapter({ ...http, sleep }).pull("tok", "primary", "s0", WINDOW, TZ);
    expect(res.nextCursor).toBe("s");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("creates with a deterministic id and marker; a retried create (409) reuses the event", async () => {
    const http = scripted([
      json({ error: { code: 409 } }, 409),
      json({ id: "fixed", status: "confirmed", etag: '"9"', updated: "2026-09-28T00:00:00Z" }),
    ]);
    const res = await createGoogleAdapter(http).create("tok", "primary", INPUT);
    expect(res).toMatchObject({ id: "fixed", etag: '"9"' });
    const body = JSON.parse(String(http.calls[0].init.body));
    expect(body.id).toMatch(/^[0-9a-f]{64}$/);
    expect(body.extendedProperties.private).toEqual({ fpConnection: "conn1", fpEvent: "evt1" });
    expect(body.start).toMatchObject({ dateTime: "2026-10-05T14:00:00.000Z" });
    expect(http.calls[1].url).toContain(`/events/${body.id}`);
  });

  it("update returns null when the event is gone; delete tolerates 404/410", async () => {
    const http = scripted([json({}, 404), new Response(null, { status: 410 })]);
    const adapter = createGoogleAdapter(http);
    expect(await adapter.update("tok", "primary", "x", INPUT)).toBeNull();
    await expect(adapter.remove("tok", "primary", "x")).resolves.toBeUndefined();
    expect(http.calls.map((c) => c.init.method)).toEqual(["PATCH", "DELETE"]);
  });

  it("OAuth: authorize URL has PKCE, minimal scopes, offline access, no secret", () => {
    const config: ProviderConfig = {
      provider: "google",
      clientId: "cid",
      clientSecret: "SECRET-VALUE",
      redirectUri: "https://family.example.test/api/calendar/connections/google/callback",
    };
    const url = new URL(createGoogleOAuth().authorizeUrl(config, "st", "ch"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.toString()).not.toContain("SECRET-VALUE");
  });

  it("OAuth: the scopes are exactly the two the runbook lists", () => {
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
  });

  it("OAuth: a code exchange reports the granted scopes; a missing calendar box is detected", async () => {
    const http = scripted([
      json({
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        token_type: "Bearer",
      }),
    ]);
    const config = { provider: "google" as const, clientId: "c", clientSecret: "s", redirectUri: "https://x.test/cb" };
    const oauth = createGoogleOAuth(http);
    const tokens = await oauth.exchangeCode(config, "code", "verifier");
    expect(tokens).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
    const form = new URLSearchParams(String(http.calls[0].init.body));
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("redirect_uri")).toBe("https://x.test/cb");
    expect(oauth.hasRequiredScopes(tokens.scope)).toBe(false);
    expect(oauth.hasRequiredScopes(GOOGLE_SCOPES.join(" "))).toBe(true);
    expect(oauth.hasRequiredScopes(`openid ${[...GOOGLE_SCOPES].reverse().join(" ")}`)).toBe(true);
    expect(oauth.hasRequiredScopes(null)).toBe(true);
  });

  it("OAuth: refresh with invalid_grant is a grant error", async () => {
    const http = scripted([json({ error: "invalid_grant" }, 400)]);
    const config = { provider: "google" as const, clientId: "c", clientSecret: "s", redirectUri: "https://x.test/cb" };
    await expect(createGoogleOAuth(http).refresh(config, "rt")).rejects.toBeInstanceOf(OAuthGrantError);
    expect(new URL(http.calls[0].url).hostname).toBe("oauth2.googleapis.com");
  });
});

describe("Microsoft adapter", () => {
  it("follows nextLink pages to a deltaLink; maps @removed and all-day", async () => {
    const http = scripted([
      json({
        value: [
          {
            id: "m1", subject: "Standup", "@odata.etag": 'W/"1"', lastModifiedDateTime: "2026-09-20T10:00:00Z",
            start: { dateTime: "2026-10-01T13:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-10-01T13:30:00.0000000", timeZone: "UTC" },
            body: { contentType: "text", content: "Agenda" }, location: { displayName: "Room 1" },
            transactionId: transactionIdFor("conn1", "evt1"),
          },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView/delta?$skiptoken=abc",
      }),
      json({
        value: [
          { id: "m2", subject: "Holiday", isAllDay: true, start: { dateTime: "2026-10-12T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-13T00:00:00.0000000", timeZone: "UTC" } },
          { id: "m3", "@removed": { reason: "deleted" } },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView/delta?$deltatoken=xyz",
      }),
    ]);
    const res = await createMicrosoftAdapter(http).pull("tok", "cal", null, WINDOW, TZ);
    expect(res).toMatchObject({ full: true, nextCursor: expect.stringContaining("$deltatoken=xyz") });
    expect(res.events[0]).toMatchObject({
      id: "m1", title: "Standup", description: "Agenda", location: "Room 1", deleted: false,
      marker: { connectionId: "conn1", eventId: "evt1" },
    });
    expect(res.events[0].start.toISOString()).toBe("2026-10-01T13:00:00.000Z");
    expect(res.events[1]).toMatchObject({ allDay: true });
    expect(res.events[1].start.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(res.events[2]).toMatchObject({ id: "m3", deleted: true });
    const first = new URL(http.calls[0].url);
    expect(first.pathname).toBe("/v1.0/me/calendars/cal/calendarView/delta");
    expect(first.searchParams.get("startDateTime")).toBe(WINDOW.start.toISOString());
    expect(String((http.calls[0].init.headers as Record<string, string>).prefer)).toContain('outlook.timezone="UTC"');
  });

  it("refuses a tampered cursor or nextLink pointing off Graph", async () => {
    expect(() => assertGraphLink("https://evil.example/v1.0/me")).toThrow();
    expect(() => assertGraphLink("https://graph.microsoft.com/beta/me")).toThrow();
    const http = scripted([]);
    await expect(
      createMicrosoftAdapter(http).pull("tok", "cal", "https://169.254.169.254/v1.0/x", WINDOW, TZ),
    ).rejects.toMatchObject({ code: "blocked_host" });
    expect(http.fetchImpl).not.toHaveBeenCalled();

    const http2 = scripted([json({ value: [], "@odata.nextLink": "https://attacker.example/v1.0/next" })]);
    await expect(
      createMicrosoftAdapter(http2).pull("tok", "cal", null, WINDOW, TZ),
    ).rejects.toMatchObject({ code: "blocked_host" });
    expect(http2.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("410 on the delta link is a full-resync signal", async () => {
    const http = scripted([json({ error: { code: "SyncStateNotFound" } }, 410)]);
    await expect(
      createMicrosoftAdapter(http).pull(
        "tok", "cal", "https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView/delta?$deltatoken=old", WINDOW, TZ,
      ),
    ).rejects.toBeInstanceOf(CursorExpiredError);
  });

  it("creates with an idempotent transactionId; update/delete by id", async () => {
    const http = scripted([
      json({ id: "new1", "@odata.etag": 'W/"2"', lastModifiedDateTime: "2026-09-28T00:00:00Z" }, 201),
      json({}, 404),
      new Response(null, { status: 204 }),
    ]);
    const a = createMicrosoftAdapter(http);
    expect(await a.create("tok", "cal", INPUT)).toMatchObject({ id: "new1", etag: 'W/"2"' });
    const body = JSON.parse(String(http.calls[0].init.body));
    expect(body.transactionId).toBe("fp.conn1.evt1");
    expect(body.start).toEqual({ dateTime: "2026-10-05T14:00:00.000", timeZone: "UTC" });
    expect(await a.update("tok", "cal", "gone", INPUT)).toBeNull();
    await a.remove("tok", "cal", "id/with=chars");
    expect(http.calls[2].url).toBe("https://graph.microsoft.com/v1.0/me/events/id%2Fwith%3Dchars");
  });

  it("OAuth: tenant-scoped endpoints, minimal scopes, PKCE; revoke is a no-op", async () => {
    const config: ProviderConfig = {
      provider: "microsoft",
      clientId: "cid",
      clientSecret: "SECRET-VALUE",
      tenant: "common",
      redirectUri: "https://family.example.test/api/calendar/connections/microsoft/callback",
    };
    const url = new URL(createMicrosoftOAuth().authorizeUrl(config, "st", "ch"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access Calendars.ReadWrite");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("SECRET-VALUE");

    const http = scripted([json({ access_token: "at", refresh_token: "rt2", expires_in: 3600 })]);
    const set = await createMicrosoftOAuth(http).exchangeCode(config, "code", "verifier");
    expect(set).toMatchObject({ accessToken: "at", refreshToken: "rt2" });
    const form = new URLSearchParams(String(http.calls[0].init.body));
    expect(form.get("code_verifier")).toBe("verifier");
    expect(http.calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    await expect(createMicrosoftOAuth(scripted([])).revoke(config, "rt")).resolves.toBeUndefined();
  });
});
