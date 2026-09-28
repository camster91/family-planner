// Google Calendar adapter + OAuth client (#264).
//
// API: Calendar v3 (https://www.googleapis.com/calendar/v3). Incremental sync
// uses events.list nextSyncToken; HTTP 410 means the token expired and a full
// resync is required. Recurring events are listed as single instances
// (singleEvents=true), each with its own id, so edits and deletes of one
// occurrence map to one local row.

import type { ProviderConfig } from "./config";
import {
  ensureOk,
  providerFetch,
  ProviderHttpError,
  readJson,
  type HttpDeps,
} from "./http";
import {
  cleanText,
  cleanTitle,
  createKey,
  instantToLocalDate,
  localDateToInstant,
  MAX_DESCRIPTION,
  MAX_LOCATION,
} from "./mapping";
import { postTokenForm } from "./oauth-common";
import {
  CursorExpiredError,
  type CalendarProviderAdapter,
  type EventInput,
  type OAuthClient,
  type PullResult,
  type PullWindow,
  type PushResult,
  type RemoteCalendar,
  type RemoteEvent,
} from "./types";

export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

// Minimal scopes: read/write events, and read the calendar list so the member
// can choose which calendar to sync. No Gmail, Drive, profile or full
// calendar-settings access.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export const MAX_PAGES = 50;

const auth = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/json",
});

function parseWhen(
  when: any,
  timeZone: string,
): { at: Date; allDay: boolean } | null {
  if (!when || typeof when !== "object") return null;
  if (typeof when.dateTime === "string") {
    const at = new Date(when.dateTime);
    return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
  }
  if (typeof when.date === "string") {
    const at = localDateToInstant(when.date, timeZone);
    return at ? { at, allDay: true } : null;
  }
  return null;
}

export function parseGoogleEvent(
  item: any,
  timeZone: string,
): RemoteEvent | null {
  if (!item || typeof item.id !== "string" || !item.id) return null;
  const updated =
    typeof item.updated === "string" ? new Date(item.updated) : null;
  const priv = item.extendedProperties?.private ?? {};
  const marker =
    typeof priv.fpConnection === "string" && typeof priv.fpEvent === "string"
      ? { connectionId: priv.fpConnection, eventId: priv.fpEvent }
      : null;
  const base = {
    id: item.id as string,
    etag: typeof item.etag === "string" ? item.etag : null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    marker,
  };
  if (item.status === "cancelled") {
    return {
      ...base,
      deleted: true,
      title: "",
      description: null,
      location: null,
      start: new Date(0),
      end: new Date(0),
      allDay: false,
    };
  }
  const start = parseWhen(item.start, timeZone);
  const end = parseWhen(item.end, timeZone) ?? start;
  if (!start || !end) return null;
  return {
    ...base,
    deleted: false,
    title: cleanTitle(item.summary),
    description: cleanText(item.description, MAX_DESCRIPTION),
    location: cleanText(item.location, MAX_LOCATION),
    start: start.at,
    end: end.at.getTime() < start.at.getTime() ? start.at : end.at,
    allDay: start.allDay,
  };
}

function toGoogleBody(input: EventInput) {
  const when = (d: Date) =>
    input.allDay
      ? { date: instantToLocalDate(d, input.timeZone), dateTime: null }
      : { dateTime: d.toISOString(), timeZone: "UTC", date: null };
  return {
    summary: input.title,
    description: input.description ?? "",
    location: input.location ?? "",
    start: when(input.start),
    end: when(input.end),
    extendedProperties: {
      private: {
        fpConnection: input.marker.connectionId,
        fpEvent: input.marker.eventId,
      },
    },
  };
}

function pushResult(item: any): PushResult {
  if (!item || typeof item.id !== "string")
    throw new ProviderHttpError("bad_response");
  const updated =
    typeof item.updated === "string" ? new Date(item.updated) : null;
  return {
    id: item.id,
    etag: typeof item.etag === "string" ? item.etag : null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  };
}

export function createGoogleAdapter(deps: HttpDeps = {}): CalendarProviderAdapter {
  const eventsUrl = (calendarId: string) =>
    `${API}/calendars/${encodeURIComponent(calendarId)}/events`;

  return {
    provider: "google",

    async listCalendars(token) {
      const out: RemoteCalendar[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < 10; page++) {
        const url = new URL(`${API}/users/me/calendarList`);
        url.searchParams.set("minAccessRole", "writer");
        url.searchParams.set("maxResults", "250");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await ensureOk(
          await providerFetch(url.toString(), { headers: auth(token) }, deps),
        );
        const body = await readJson(res);
        for (const item of Array.isArray(body.items) ? body.items : []) {
          if (typeof item?.id !== "string") continue;
          out.push({
            id: item.id,
            name: cleanText(item.summaryOverride ?? item.summary, 120) ?? item.id,
            primary: item.primary === true,
            canWrite: item.accessRole === "owner" || item.accessRole === "writer",
          });
        }
        pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
        if (!pageToken) break;
      }
      return out;
    },

    async pull(token, calendarId, cursor, window: PullWindow, timeZone) {
      const events: RemoteEvent[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(eventsUrl(calendarId));
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("showDeleted", "true");
        url.searchParams.set("maxResults", "250");
        if (cursor) {
          url.searchParams.set("syncToken", cursor);
        } else {
          url.searchParams.set("timeMin", window.start.toISOString());
          url.searchParams.set("timeMax", window.end.toISOString());
        }
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await providerFetch(
          url.toString(),
          { headers: auth(token) },
          deps,
        );
        if (res.status === 410) {
          await res.body?.cancel().catch(() => undefined);
          throw new CursorExpiredError();
        }
        await ensureOk(res);
        const body = await readJson(res);
        for (const item of Array.isArray(body.items) ? body.items : []) {
          const parsed = parseGoogleEvent(item, timeZone);
          if (parsed) events.push(parsed);
        }
        pageToken =
          typeof body.nextPageToken === "string" ? body.nextPageToken : null;
        if (!pageToken) {
          const next =
            typeof body.nextSyncToken === "string" ? body.nextSyncToken : null;
          return { events, nextCursor: next, full: !cursor } as PullResult;
        }
      }
      throw new ProviderHttpError("too_large");
    },

    async create(token, calendarId, input) {
      const id = createKey(input.marker.connectionId, input.marker.eventId);
      const body = { id, ...toGoogleBody(input) };
      const res = await providerFetch(
        eventsUrl(calendarId),
        {
          method: "POST",
          headers: { ...auth(token), "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        deps,
      );
      if (res.status === 409) {
        // A retried create: the event with our deterministic id exists.
        await res.body?.cancel().catch(() => undefined);
        const existing = await providerFetch(
          `${eventsUrl(calendarId)}/${encodeURIComponent(id)}`,
          { headers: auth(token) },
          deps,
        );
        await ensureOk(existing);
        const item = await readJson(existing);
        if (item?.status !== "cancelled") return pushResult(item);
        // That id was used by an event since deleted; create with a server id.
        const again = await providerFetch(
          eventsUrl(calendarId),
          {
            method: "POST",
            headers: { ...auth(token), "content-type": "application/json" },
            body: JSON.stringify(toGoogleBody(input)),
          },
          deps,
        );
        await ensureOk(again);
        return pushResult(await readJson(again));
      }
      await ensureOk(res);
      return pushResult(await readJson(res));
    },

    async update(token, calendarId, externalId, input) {
      const res = await providerFetch(
        `${eventsUrl(calendarId)}/${encodeURIComponent(externalId)}`,
        {
          method: "PATCH",
          headers: { ...auth(token), "content-type": "application/json" },
          body: JSON.stringify(toGoogleBody(input)),
        },
        deps,
      );
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      await ensureOk(res);
      return pushResult(await readJson(res));
    },

    async remove(token, calendarId, externalId) {
      const res = await providerFetch(
        `${eventsUrl(calendarId)}/${encodeURIComponent(externalId)}`,
        { method: "DELETE", headers: auth(token) },
        deps,
      );
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 404 || res.status === 410) return;
      await ensureOk(res);
    },
  };
}

export function createGoogleOAuth(deps: HttpDeps = {}): OAuthClient {
  return {
    provider: "google",
    scopes: GOOGLE_SCOPES,

    authorizeUrl(config: ProviderConfig, state, codeChallenge) {
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      // offline + consent: Google only issues a refresh token this way.
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "false");
      return url.toString();
    },

    exchangeCode(config, code, codeVerifier) {
      return postTokenForm(
        GOOGLE_TOKEN_URL,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        },
        deps,
        { refresh: false },
      );
    },

    refresh(config, refreshToken) {
      return postTokenForm(
        GOOGLE_TOKEN_URL,
        {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        },
        deps,
        { refresh: true },
      );
    },

    async revoke(_config, token) {
      const res = await providerFetch(
        GOOGLE_REVOKE_URL,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        },
        deps,
      );
      await res.body?.cancel().catch(() => undefined);
    },
  };
}
