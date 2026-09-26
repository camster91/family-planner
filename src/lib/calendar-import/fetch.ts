// Guarded fetch of a subscribed ICS feed (#232).
//
// The feed URL is user-supplied, so every hop goes through the SSRF guard in
// lib/outbound-url.ts: https only, no credentials, no private/loopback/
// link-local/metadata addresses (checked again after DNS resolution).
// Redirects are followed manually (max MAX_REDIRECTS) so each Location is
// re-validated. Responses are time- and size-bounded.
//
// Errors carry a short fixed message and a code; never the URL or any body.

import {
  assertPublicProviderUrl,
  checkProviderUrlShape,
} from "@/lib/outbound-url";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

export type FeedErrorCode =
  | "url_not_allowed"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "http_error"
  | "network"
  | "not_calendar";

const MESSAGES: Record<FeedErrorCode, string> = {
  url_not_allowed: "Feed address is not allowed",
  timeout: "Feed took too long to respond",
  too_large: "Feed is larger than 2 MB",
  too_many_redirects: "Feed redirected too many times",
  http_error: "Feed could not be downloaded",
  network: "Could not reach the feed",
  not_calendar: "Feed is not a valid calendar",
};

export class FeedFetchError extends Error {
  constructor(
    public readonly code: FeedErrorCode,
    public readonly httpStatus?: number,
  ) {
    super(
      httpStatus ? `${MESSAGES[code]} (HTTP ${httpStatus})` : MESSAGES[code],
    );
    this.name = "FeedFetchError";
  }
}

/**
 * Accept https:// and webcal(s):// (the de-facto scheme calendar apps hand out,
 * which is plain HTTPS underneath). Returns the https URL or null.
 */
export function normalizeFeedUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const rewritten = /^webcals?:\/\//i.test(trimmed)
    ? trimmed.replace(/^webcals?:\/\//i, "https://")
    : trimmed;
  try {
    const url = new URL(rewritten);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Shape check for storing a feed URL. Returns an error message or null. */
export function checkFeedUrlShape(raw: string): string | null {
  const normalized = normalizeFeedUrl(raw);
  if (!normalized) return "That calendar link is not valid";
  const error = checkProviderUrlShape(normalized);
  if (!error) return null;
  // Reuse the guard, but word it for calendars.
  if (error.includes("https"))
    return "Calendar links must start with https:// or webcal://";
  if (error.includes("credentials"))
    return "Calendar links must not contain a username or password";
  if (error.includes("public"))
    return "Calendar links must point to a public address";
  return "That calendar link is not valid";
}

/** Display hint for a stored feed URL: host only, never the path or query (they often hold a secret token). */
export function feedUrlHint(url: string | null): string {
  if (!url) return "Unavailable";
  try {
    return `${new URL(url).hostname}/…`;
  } catch {
    return "Unavailable";
  }
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: FetchLike;
  assertUrl?: (url: string) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchFeedResult =
  | { notModified: true }
  | {
      notModified: false;
      body: string;
      etag: string | null;
      lastModified: string | null;
    };

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new FeedFetchError("too_large");
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes)
      throw new FeedFetchError("too_large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FeedFetchError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Fetch a feed with conditional headers, manual guarded redirects, a timeout and a size cap. */
export async function fetchFeed(
  rawUrl: string,
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const assertUrl = options.assertUrl ?? assertPublicProviderUrl;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;

  let current = normalizeFeedUrl(rawUrl);
  if (!current) throw new FeedFetchError("url_not_allowed");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        await assertUrl(current);
      } catch {
        throw new FeedFetchError("url_not_allowed");
      }

      const headers: Record<string, string> = {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "FamilyPlanner-CalendarImport/1.0",
      };
      // Validators only apply to the URL they came from, i.e. the first hop.
      if (hop === 0 && options.etag) headers["If-None-Match"] = options.etag;
      if (hop === 0 && options.lastModified)
        headers["If-Modified-Since"] = options.lastModified;

      let res: Response;
      try {
        res = await fetchImpl(current, {
          redirect: "manual",
          signal: controller.signal,
          headers,
        });
      } catch {
        if (controller.signal.aborted) throw new FeedFetchError("timeout");
        throw new FeedFetchError("network");
      }

      if (res.status === 304) return { notModified: true };

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new FeedFetchError("http_error", res.status);
        let nextUrl: string | null;
        try {
          nextUrl = normalizeFeedUrl(new URL(location, current).toString());
        } catch {
          nextUrl = null;
        }
        if (!nextUrl) throw new FeedFetchError("url_not_allowed");
        current = nextUrl;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new FeedFetchError("http_error", res.status);
      }

      let body: string;
      try {
        body = await readBounded(res, maxBytes);
      } catch (err) {
        if (err instanceof FeedFetchError) throw err;
        if (controller.signal.aborted) throw new FeedFetchError("timeout");
        throw new FeedFetchError("network");
      }
      return {
        notModified: false,
        body,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
    }
    throw new FeedFetchError("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}
