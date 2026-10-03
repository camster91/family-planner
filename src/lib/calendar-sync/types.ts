// Provider-neutral shapes for two-way calendar sync (#264).

import type { Provider, ProviderConfig } from "./config";
import type { HttpDeps } from "./http";

export interface RemoteCalendar {
  id: string;
  name: string;
  primary: boolean;
  canWrite: boolean;
}

/** Marker the app writes on events it creates, so a crash between the
 * provider create and the local link write cannot import a duplicate. */
export interface LocalMarker {
  connectionId: string;
  eventId: string;
}

export interface RemoteEvent {
  id: string;
  deleted: boolean;
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  etag: string | null;
  updated: Date | null;
  marker: LocalMarker | null;
}

export interface PullWindow {
  start: Date;
  end: Date;
}

export interface PullResult {
  events: RemoteEvent[];
  /** Google nextSyncToken / Graph @odata.deltaLink for the next incremental pull. */
  nextCursor: string | null;
  /** True when this was a full (not incremental) listing. */
  full: boolean;
}

export interface EventInput {
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Household time zone, used to express all-day dates. */
  timeZone: string;
  marker: LocalMarker;
}

export interface PushResult {
  id: string;
  etag: string | null;
  updated: Date | null;
}

/** Stored sync cursor is no longer valid (HTTP 410): run a full resync. */
export class CursorExpiredError extends Error {
  constructor() {
    super("Sync cursor expired");
    this.name = "CursorExpiredError";
  }
}

export interface CalendarProviderAdapter {
  readonly provider: Provider;
  listCalendars(accessToken: string): Promise<RemoteCalendar[]>;
  /** Incremental when `cursor` is set; full listing of the window otherwise. Handles paging. */
  pull(
    accessToken: string,
    calendarId: string,
    cursor: string | null,
    window: PullWindow,
    timeZone: string,
  ): Promise<PullResult>;
  create(
    accessToken: string,
    calendarId: string,
    input: EventInput,
  ): Promise<PushResult>;
  /** Null when the provider event no longer exists (404/410). */
  update(
    accessToken: string,
    calendarId: string,
    externalId: string,
    input: EventInput,
  ): Promise<PushResult | null>;
  /** Succeeds when the event is already gone. */
  remove(
    accessToken: string,
    calendarId: string,
    externalId: string,
  ): Promise<void>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
}

/** Refresh token rejected (revoked, expired, consent withdrawn): reconnect needed. */
export class OAuthGrantError extends Error {
  constructor() {
    super("Calendar authorization is no longer valid");
    this.name = "OAuthGrantError";
  }
}

export interface OAuthClient {
  readonly provider: Provider;
  readonly scopes: string[];
  authorizeUrl(
    config: ProviderConfig,
    state: string,
    codeChallenge: string,
  ): string;
  exchangeCode(
    config: ProviderConfig,
    code: string,
    codeVerifier: string,
  ): Promise<TokenSet>;
  refresh(config: ProviderConfig, refreshToken: string): Promise<TokenSet>;
  /**
   * False when the token response says the member did not grant every scope
   * the app needs (Google lets people untick boxes on the consent screen).
   * True when the response does not list scopes.
   */
  hasRequiredScopes(granted: string | null): boolean;
  /** Best effort; resolves even when the provider has no revocation endpoint. */
  revoke(config: ProviderConfig, token: string): Promise<void>;
}

export type AdapterFactory = (deps?: HttpDeps) => CalendarProviderAdapter;
