// Microsoft Graph (Outlook / Microsoft 365) calendar adapter + OAuth client (#264).
//
// Incremental sync uses calendarView delta: follow @odata.nextLink pages until
// an @odata.deltaLink, which is stored as the cursor. HTTP 410 means the
// delta state expired and a full resync is required. Every nextLink /
// deltaLink is re-validated against the provider host allowlist before use,
// so a tampered cursor cannot point the server anywhere else.

import type { ProviderConfig } from "./config";
import {
  assertProviderUrl,
  ensureOk,
  providerFetch,
  ProviderHttpError,
  readJson,
  type HttpDeps,
} from "./http";
import {
  cleanText,
  cleanTitle,
  instantToLocalDate,
  localDateToInstant,
  MAX_DESCRIPTION,
  MAX_LOCATION,
} from "./mapping";
import { postTokenForm } from "./oauth-common";
import { isValidTimeZone, zonedWallTimeToUtc } from "@/lib/calendar-import/timezone";
import {
  CursorExpiredError,
  type CalendarProviderAdapter,
  type EventInput,
  type OAuthClient,
  type PushResult,
  type RemoteCalendar,
  type RemoteEvent,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";

// Minimal delegated scopes: read/write the member's calendars, plus
// offline_access for a refresh token. No mail, contacts or profile.
export const MICROSOFT_SCOPES = ["offline_access", "Calendars.ReadWrite"];

export const MAX_PAGES = 50;

export const microsoftAuthorizeUrl = (tenant: string) =>
  `${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
export const microsoftTokenUrl = (tenant: string) =>
  `${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

const PREFER = [
  'outlook.timezone="UTC"',
  'outlook.body-content-type="text"',
  "odata.maxpagesize=100",
].join(", ");

const auth = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/json",
  prefer: PREFER,
});

/** Cursor / paging links must stay on Graph v1.0. */
export function assertGraphLink(raw: string): string {
  const url = assertProviderUrl(raw);
  if (url.hostname !== "graph.microsoft.com" || !url.pathname.startsWith("/v1.0/"))
    throw new ProviderHttpError("blocked_host");
  return url.toString();
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

function parseGraphTime(
  value: any,
  allDay: boolean,
  householdZone: string,
): Date | null {
  if (!value || typeof value.dateTime !== "string") return null;
  const m = WALL_RE.exec(value.dateTime);
  if (!m) return null;
  if (allDay) return localDateToInstant(value.dateTime.slice(0, 10), householdZone);
  const wall = {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +m[4],
    minute: +m[5],
    second: +(m[6] ?? 0),
  };
  const zone = typeof value.timeZone === "string" ? value.timeZone : "UTC";
  if (zone !== "UTC" && isValidTimeZone(zone)) return zonedWallTimeToUtc(wall, zone);
  return new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
  );
}

const MARKER_RE = /^fp\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{1,64})$/;

export const transactionIdFor = (connectionId: string, eventId: string) =>
  `fp.${connectionId}.${eventId}`;

export function parseGraphEvent(
  item: any,
  householdZone: string,
): RemoteEvent | null {
  if (!item || typeof item.id !== "string" || !item.id) return null;
  const updated =
    typeof item.lastModifiedDateTime === "string"
      ? new Date(item.lastModifiedDateTime)
      : null;
  const m =
    typeof item.transactionId === "string" ? MARKER_RE.exec(item.transactionId) : null;
  const base = {
    id: item.id as string,
    etag:
      typeof item["@odata.etag"] === "string"
        ? item["@odata.etag"]
        : typeof item.changeKey === "string"
          ? item.changeKey
          : null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    marker: m ? { connectionId: m[1], eventId: m[2] } : null,
  };
  if (item["@removed"] || item.isCancelled === true) {
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
  const allDay = item.isAllDay === true;
  const start = parseGraphTime(item.start, allDay, householdZone);
  const end = parseGraphTime(item.end, allDay, householdZone) ?? start;
  if (!start || !end) return null;
  const body =
    item.body && item.body.contentType === "text" ? item.body.content : item.bodyPreview;
  return {
    ...base,
    deleted: false,
    title: cleanTitle(item.subject),
    description: cleanText(body, MAX_DESCRIPTION),
    location: cleanText(item.location?.displayName, MAX_LOCATION),
    start,
    end: end.getTime() < start.getTime() ? start : end,
    allDay,
  };
}

function toGraphBody(input: EventInput) {
  const when = (d: Date) =>
    input.allDay
      ? { dateTime: `${instantToLocalDate(d, input.timeZone)}T00:00:00`, timeZone: "UTC" }
      : { dateTime: d.toISOString().slice(0, 23), timeZone: "UTC" };
  return {
    subject: input.title,
    body: { contentType: "text", content: input.description ?? "" },
    location: { displayName: input.location ?? "" },
    start: when(input.start),
    end: when(input.end),
    isAllDay: input.allDay,
  };
}

function pushResult(item: any): PushResult {
  if (!item || typeof item.id !== "string")
    throw new ProviderHttpError("bad_response");
  const updated =
    typeof item.lastModifiedDateTime === "string"
      ? new Date(item.lastModifiedDateTime)
      : null;
  return {
    id: item.id,
    etag:
      typeof item["@odata.etag"] === "string"
        ? item["@odata.etag"]
        : typeof item.changeKey === "string"
          ? item.changeKey
          : null,
    updated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  };
}

export function createMicrosoftAdapter(
  deps: HttpDeps = {},
): CalendarProviderAdapter {
  const eventUrl = (id: string) => `${GRAPH}/me/events/${encodeURIComponent(id)}`;

  return {
    provider: "microsoft",

    async listCalendars(token) {
      const out: RemoteCalendar[] = [];
      let next: string | null =
        `${GRAPH}/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100`;
      for (let page = 0; next && page < 10; page++) {
        const res = await ensureOk(
          await providerFetch(assertGraphLink(next), { headers: auth(token) }, deps),
        );
        const body = await readJson(res);
        for (const item of Array.isArray(body.value) ? body.value : []) {
          if (typeof item?.id !== "string") continue;
          out.push({
            id: item.id,
            name: cleanText(item.name, 120) ?? "Calendar",
            primary: item.isDefaultCalendar === true,
            canWrite: item.canEdit !== false,
          });
        }
        next = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
      }
      return out;
    },

    async pull(token, calendarId, cursor, window, timeZone) {
      const events: RemoteEvent[] = [];
      let next: string;
      if (cursor) {
        next = assertGraphLink(cursor);
      } else {
        const url = new URL(
          `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`,
        );
        url.searchParams.set("startDateTime", window.start.toISOString());
        url.searchParams.set("endDateTime", window.end.toISOString());
        next = url.toString();
      }
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await providerFetch(assertGraphLink(next), { headers: auth(token) }, deps);
        if (res.status === 410) {
          await res.body?.cancel().catch(() => undefined);
          throw new CursorExpiredError();
        }
        await ensureOk(res);
        const body = await readJson(res);
        for (const item of Array.isArray(body.value) ? body.value : []) {
          const parsed = parseGraphEvent(item, timeZone);
          if (parsed) events.push(parsed);
        }
        if (typeof body["@odata.nextLink"] === "string") {
          next = body["@odata.nextLink"];
          continue;
        }
        const delta =
          typeof body["@odata.deltaLink"] === "string"
            ? assertGraphLink(body["@odata.deltaLink"])
            : null;
        return { events, nextCursor: delta, full: !cursor };
      }
      throw new ProviderHttpError("too_large");
    },

    async create(token, calendarId, input) {
      const res = await providerFetch(
        `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: { ...auth(token), "content-type": "application/json" },
          // transactionId makes a retried create return the same event.
          body: JSON.stringify({
            ...toGraphBody(input),
            transactionId: transactionIdFor(
              input.marker.connectionId,
              input.marker.eventId,
            ),
          }),
        },
        deps,
      );
      await ensureOk(res);
      return pushResult(await readJson(res));
    },

    async update(token, _calendarId, externalId, input) {
      const res = await providerFetch(
        eventUrl(externalId),
        {
          method: "PATCH",
          headers: { ...auth(token), "content-type": "application/json" },
          body: JSON.stringify(toGraphBody(input)),
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

    async remove(token, _calendarId, externalId) {
      const res = await providerFetch(
        eventUrl(externalId),
        { method: "DELETE", headers: auth(token) },
        deps,
      );
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 404 || res.status === 410) return;
      await ensureOk(res);
    },
  };
}

export function createMicrosoftOAuth(deps: HttpDeps = {}): OAuthClient {
  const tenantOf = (config: ProviderConfig) => config.tenant ?? "common";
  return {
    provider: "microsoft",
    scopes: MICROSOFT_SCOPES,

    authorizeUrl(config, state, codeChallenge) {
      const url = new URL(microsoftAuthorizeUrl(tenantOf(config)));
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },

    exchangeCode(config, code, codeVerifier) {
      return postTokenForm(
        microsoftTokenUrl(tenantOf(config)),
        {
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          scope: MICROSOFT_SCOPES.join(" "),
        },
        deps,
        { refresh: false },
      );
    },

    refresh(config, refreshToken) {
      return postTokenForm(
        microsoftTokenUrl(tenantOf(config)),
        {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: MICROSOFT_SCOPES.join(" "),
        },
        deps,
        { refresh: true },
      );
    },

    // Microsoft identity platform has no per-app refresh-token revocation
    // endpoint for delegated consent; deleting our copy is the revocation.
    // The runbook tells members how to remove the app's consent themselves.
    async revoke() {
      return;
    },
  };
}
