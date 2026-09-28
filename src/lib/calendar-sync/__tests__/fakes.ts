// Test-only fakes for calendar sync (#264). Not a test file. No network: the
// fake provider is an in-memory calendar with a change log, so sync tokens,
// deletes, 410 and rate limits can be exercised deterministically.

import { randomBytes } from "crypto";
import type { ProviderConfig } from "../config";
import { ProviderHttpError } from "../http";
import {
  CursorExpiredError,
  OAuthGrantError,
  type CalendarProviderAdapter,
  type EventInput,
  type OAuthClient,
  type PullWindow,
  type RemoteCalendar,
  type RemoteEvent,
  type TokenSet,
} from "../types";

export const TEST_TOKEN_KEY = randomBytes(32).toString("base64");

export function setSyncEnv(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    CALENDAR_TOKEN_KEY: TEST_TOKEN_KEY,
    APP_URL: "https://family.example.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret-VALUE",
    MICROSOFT_CLIENT_ID: "ms-client-id",
    MICROSOFT_CLIENT_SECRET: "ms-client-secret-VALUE",
    MICROSOFT_TENANT: "common",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export const SYNC_ENV_KEYS = [
  "CALENDAR_TOKEN_KEY",
  "CALENDAR_TOKEN_KEY_PREVIOUS",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT",
];

export function clearSyncEnv() {
  for (const k of SYNC_ENV_KEYS) delete process.env[k];
}

export const TEST_CONFIG: ProviderConfig = {
  provider: "google",
  clientId: "google-client-id",
  clientSecret: "google-client-secret-VALUE",
  redirectUri:
    "https://family.example.test/api/calendar/connections/google/callback",
};

type Stored = { ev: RemoteEvent; seq: number };

/** In-memory provider calendar with a change log (cursor = last seq seen). */
export class FakeProvider implements CalendarProviderAdapter {
  readonly provider = "google" as const;
  items = new Map<string, Stored>();
  seq = 0;
  n = 0;
  calls: string[] = [];
  /** Cursors issued before this seq are "expired" (HTTP 410). */
  minValidCursor = 0;
  /** Throw this on the next call to any method. */
  failNext: Error | null = null;
  clock = () => new Date();
  calendars: RemoteCalendar[] = [
    { id: "primary", name: "Home", primary: true, canWrite: true },
    { id: "readonly", name: "Holidays", primary: false, canWrite: false },
  ];

  private maybeFail() {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }

  private put(ev: RemoteEvent) {
    this.seq++;
    this.items.set(ev.id, { ev, seq: this.seq });
    return ev;
  }

  /** Simulate a change made directly in the provider's calendar. */
  remoteUpsert(
    id: string,
    fields: Partial<RemoteEvent> & { title?: string },
    updated = this.clock(),
  ): RemoteEvent {
    const prev = this.items.get(id)?.ev;
    const start = fields.start ?? prev?.start ?? new Date(Date.now() + 86400000);
    return this.put({
      id,
      deleted: false,
      title: fields.title ?? prev?.title ?? "Remote event",
      description: fields.description ?? prev?.description ?? null,
      location: fields.location ?? prev?.location ?? null,
      start,
      end: fields.end ?? prev?.end ?? new Date(start.getTime() + 3600000),
      allDay: fields.allDay ?? prev?.allDay ?? false,
      etag: `"${id}-${this.seq + 1}"`,
      updated,
      marker: fields.marker ?? prev?.marker ?? null,
    });
  }

  remoteDelete(id: string) {
    const prev = this.items.get(id)?.ev;
    if (!prev) return;
    this.put({ ...prev, deleted: true, etag: `"${id}-${this.seq + 1}"`, updated: this.clock() });
  }

  live(): RemoteEvent[] {
    return [...this.items.values()].filter((s) => !s.ev.deleted).map((s) => s.ev);
  }

  async listCalendars() {
    this.calls.push("listCalendars");
    this.maybeFail();
    return this.calendars;
  }

  async pull(_t: string, _cal: string, cursor: string | null, _w: PullWindow) {
    this.calls.push(`pull:${cursor ?? "full"}`);
    this.maybeFail();
    if (cursor !== null) {
      const since = Number(cursor);
      if (!Number.isFinite(since) || since < this.minValidCursor)
        throw new CursorExpiredError();
      const events = [...this.items.values()]
        .filter((s) => s.seq > since)
        .map((s) => s.ev);
      return { events, nextCursor: String(this.seq), full: false };
    }
    return { events: this.live(), nextCursor: String(this.seq), full: true };
  }

  async create(_t: string, _cal: string, input: EventInput) {
    this.calls.push("create");
    this.maybeFail();
    this.n++;
    const ev = this.remoteUpsert(`g-${this.n}`, {
      title: input.title,
      description: input.description,
      location: input.location,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      marker: input.marker,
    });
    return { id: ev.id, etag: ev.etag, updated: ev.updated };
  }

  async update(_t: string, _cal: string, id: string, input: EventInput) {
    this.calls.push(`update:${id}`);
    this.maybeFail();
    const cur = this.items.get(id);
    if (!cur || cur.ev.deleted) return null;
    const ev = this.remoteUpsert(id, {
      title: input.title,
      description: input.description,
      location: input.location,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
    });
    return { id: ev.id, etag: ev.etag, updated: ev.updated };
  }

  async remove(_t: string, _cal: string, id: string) {
    this.calls.push(`remove:${id}`);
    this.maybeFail();
    this.remoteDelete(id);
  }
}

export class FakeOAuth implements OAuthClient {
  readonly provider = "google" as const;
  readonly scopes = ["scope-a"];
  refreshCalls = 0;
  revoked: string[] = [];
  grantRevoked = false;
  exchangeResult: TokenSet = {
    accessToken: "ACCESS-FROM-CODE",
    refreshToken: "REFRESH-FROM-CODE",
    expiresAt: new Date(Date.now() + 3600000),
    scope: "scope-a",
  };
  exchanged: Array<{ code: string; verifier: string }> = [];

  authorizeUrl(config: ProviderConfig, state: string, challenge: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&state=${state}&code_challenge=${challenge}`;
  }
  async exchangeCode(_c: ProviderConfig, code: string, verifier: string) {
    this.exchanged.push({ code, verifier });
    return this.exchangeResult;
  }
  async refresh() {
    this.refreshCalls++;
    if (this.grantRevoked) throw new OAuthGrantError();
    return {
      accessToken: `ACCESS-REFRESHED-${this.refreshCalls}`,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600000),
      scope: null,
    };
  }
  async revoke(_c: ProviderConfig, token: string) {
    this.revoked.push(token);
  }
}

export const rateLimited = () => new ProviderHttpError("rate_limited", 429, 120000);
