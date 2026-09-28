// Outbound HTTP for calendar providers (#264).
//
// SSRF-safe by construction: requests go only to a fixed set of provider
// hosts over https, redirects are never followed, and any URL a provider
// hands back (Graph @odata.nextLink / deltaLink) is re-checked against the
// same allowlist before it is fetched. fetch is injectable so tests never
// reach the network.
//
// 429 / 503 are retried a bounded number of times, honouring Retry-After
// (seconds or HTTP date). A Retry-After beyond MAX_WAIT_MS is not waited out
// inside a request; the sync records a rate-limit error and tries later.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PROVIDER_HOSTS = new Set([
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "login.microsoftonline.com",
  "graph.microsoft.com",
]);

export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_RETRIES = 3;
export const MAX_WAIT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type ProviderErrorCode =
  | "blocked_host"
  | "network"
  | "timeout"
  | "http"
  | "rate_limited"
  | "unauthorized"
  | "too_large"
  | "bad_response";

export class ProviderHttpError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  constructor(
    code: ProviderErrorCode,
    status: number | null = null,
    retryAfterMs: number | null = null,
  ) {
    // Messages are fixed vocabulary: never provider bodies, URLs or tokens.
    super(`Calendar provider request failed (${code}${status ? ` ${status}` : ""})`);
    this.name = "ProviderHttpError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface HttpDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  maxWaitMs?: number;
}

/** Throws unless `raw` is an https URL on an allowlisted provider host. */
export function assertProviderUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderHttpError("blocked_host");
  }
  if (
    url.protocol !== "https:" ||
    !PROVIDER_HOSTS.has(url.hostname) ||
    url.port !== "" ||
    url.username ||
    url.password
  ) {
    throw new ProviderHttpError("blocked_host");
  }
  return url;
}

/** Retry-After as milliseconds (delta-seconds or HTTP date); null if absent/invalid. */
export function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function providerFetch(
  rawUrl: string,
  init: RequestInit = {},
  deps: HttpDeps = {},
): Promise<Response> {
  const url = assertProviderUrl(rawUrl);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as FetchLike);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      throw new ProviderHttpError(
        name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
      );
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      // Provider APIs do not redirect; never follow one.
      throw new ProviderHttpError("http", res.status);
    }
    if (res.status === 429 || res.status === 503) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());
      const wait = retryAfter ?? Math.min(maxWaitMs, 1000 * 2 ** attempt);
      if (attempt >= maxRetries || wait > maxWaitMs) {
        throw new ProviderHttpError("rate_limited", res.status, retryAfter);
      }
      await sleep(wait);
      continue;
    }
    return res;
  }
}

/** Read a JSON body with a size cap. */
export async function readJson<T = any>(res: Response): Promise<T> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new ProviderHttpError("too_large");
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ProviderHttpError("too_large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderHttpError("bad_response", res.status);
  }
}

/** Throw a ProviderHttpError for a non-2xx response (body is discarded). */
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
  if (res.status === 401) throw new ProviderHttpError("unauthorized", 401);
  throw new ProviderHttpError("http", res.status);
}
