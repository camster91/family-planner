import {
  LEGACY_PROXY_IP_HEADER,
  LEGACY_PROXY_SECRET_HEADER,
} from "./legacy-proxy-headers";

/**
 * The old ashbi.ca zone is a separate Cloudflare account from the canonical
 * Herewoven application. This Worker is deliberately only a request bridge:
 * it has no storage, authentication, scheduling, or application logic.
 */
export interface LegacyAliasEnv {
  LEGACY_PROXY_SECRET?: string;
  HEREWOVEN_UPSTREAM_ORIGIN?: string;
}

export type LegacyAliasFetcher = (request: Request) => Promise<Response>;

/**
 * These are the only hostnames that may be proxied. The family hostname is
 * intentionally included: its browser-visible origin must stay family.ashbi.ca
 * while the application request is served by the canonical upstream.
 */
export const ALLOWED_ALIAS_HOSTNAMES = Object.freeze([
  "family.ashbi.ca",
  "herewoven-legacy-alias.camster915391.workers.dev",
] as const);

/**
 * Keep this allowlist explicit. In particular, do not turn the Worker into an
 * open proxy if a malformed or compromised variable is supplied.
 */
export const ALLOWED_UPSTREAM_ORIGINS = Object.freeze([
  "https://herewoven.com",
  "https://herewoven.ashbi-design-preview.workers.dev",
] as const);

function resolveUpstreamOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return null;

    return (ALLOWED_UPSTREAM_ORIGINS as readonly string[]).includes(
      parsed.origin,
    )
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function unavailableResponse(): Response {
  return new Response(null, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

function upstreamFailureResponse(): Response {
  return new Response(null, {
    status: 502,
    headers: { "cache-control": "no-store" },
  });
}

function responseSetCookies(response: Response): string[] | null {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
    getAll?: (name: string) => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  if (typeof headers.getAll === "function") {
    return headers.getAll("Set-Cookie");
  }

  // Do not call Headers.get() here. It combines Set-Cookie values with
  // commas, which is lossy when a cookie contains an Expires attribute.
  return null;
}

function rewriteOwnedRedirect(
  location: string,
  incomingURL: URL,
): string | null {
  // Relative redirects stay relative. Protocol-relative redirects can still
  // point at an owned upstream and must be rewritten to the incoming origin.
  const isAbsolute = /^https?:\/\//i.test(location);
  const isProtocolRelative = /^\/\//.test(location);
  if (!isAbsolute && !isProtocolRelative) return null;

  try {
    const target = isProtocolRelative
      ? new URL(`${incomingURL.protocol}${location}`)
      : new URL(location);
    if (
      !(ALLOWED_UPSTREAM_ORIGINS as readonly string[]).includes(target.origin)
    )
      return null;

    return `${incomingURL.origin}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

function proxyRequestHeaders(
  request: Request,
  incomingURL: URL,
  secret: string,
): Headers {
  const headers = new Headers(request.headers);

  // The target must route using the target URL, not an old Host header.
  headers.delete("host");
  // These are controlled hop headers. Never forward caller-supplied values.
  headers.set("x-forwarded-host", incomingURL.host);
  headers.set("x-forwarded-proto", incomingURL.protocol.slice(0, -1));
  headers.set(LEGACY_PROXY_SECRET_HEADER, secret);

  const clientIP = request.headers.get("CF-Connecting-IP");
  if (clientIP) {
    headers.set(LEGACY_PROXY_IP_HEADER, clientIP);
  } else {
    headers.delete(LEGACY_PROXY_IP_HEADER);
  }

  return headers;
}

function targetURLForRequest(upstreamOrigin: string, incomingURL: URL): URL {
  const target = new URL(upstreamOrigin);
  target.pathname = incomingURL.pathname;
  target.search = incomingURL.search;
  return target;
}

function rewriteResponse(response: Response, incomingURL: URL): Response {
  // A 101 response may carry a WebSocket; reconstructing it as a normal
  // Response would discard the upgrade. It has no redirect body to adapt.
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  const setCookies = responseSetCookies(response);
  if (setCookies) {
    headers.delete("set-cookie");
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
  }

  const location = response.headers.get("location");
  const rewrittenLocation = location
    ? rewriteOwnedRedirect(location, incomingURL)
    : null;
  if (rewrittenLocation) headers.set("location", rewrittenLocation);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleLegacyAliasRequest(
  request: Request,
  env: LegacyAliasEnv,
  fetcher: LegacyAliasFetcher = (forwardedRequest) => fetch(forwardedRequest),
): Promise<Response> {
  const incomingURL = new URL(request.url);

  if (
    !(ALLOWED_ALIAS_HOSTNAMES as readonly string[]).includes(
      incomingURL.hostname.toLowerCase(),
    )
  ) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const upstreamOrigin = resolveUpstreamOrigin(env.HEREWOVEN_UPSTREAM_ORIGIN);
  const secret = env.LEGACY_PROXY_SECRET;
  if (!upstreamOrigin || !secret) return unavailableResponse();

  const headers = proxyRequestHeaders(request, incomingURL, secret);
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Node's standards-compatible Request constructor requires this marker
    // for a streaming request body. Workers accepts the same RequestInit and
    // continues to stream the body without buffering it.
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }

  try {
    const upstreamResponse = await fetcher(
      new Request(targetURLForRequest(upstreamOrigin, incomingURL), init),
    );
    return rewriteResponse(upstreamResponse, incomingURL);
  } catch {
    return upstreamFailureResponse();
  }
}

const legacyAliasWorker = {
  fetch(request: Request, env: LegacyAliasEnv): Promise<Response> {
    return handleLegacyAliasRequest(request, env);
  },
};

export default legacyAliasWorker;
