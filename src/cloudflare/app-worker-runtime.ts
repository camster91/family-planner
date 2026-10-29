import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  LEGACY_PROXY_IP_HEADER,
  LEGACY_PROXY_SECRET_HEADER,
} from "./legacy-proxy-headers";

/**
 * Small, dependency-free pieces shared by the Cloudflare Worker wrapper and
 * its tests. Keeping the routing policy here makes it possible to exercise
 * the security and lifecycle boundary without importing the generated
 * OpenNext bundle in Jest.
 */

export const APP_COMPUTE_POOL_SIZE = 4;
export const APP_COMPUTE_POOL_MAX_ACTIVE = 8;
const APP_COMPUTE_POOL_PREFIX = "herewoven-compute";

export type ComputePoolStub = {
  fetch(request: Request): Response | Promise<Response>;
};

export type ComputePoolNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): ComputePoolStub;
};

export type AppWorkerEnvironment = {
  APP_COMPUTE_POOL?: ComputePoolNamespace;
  /** Secret shared only by the cross-account legacy alias proxy. */
  LEGACY_PROXY_SECRET?: string;
};

export type OpenNextExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type OpenNextWorker = {
  fetch(
    request: Request,
    env: unknown,
    ctx: OpenNextExecutionContext,
  ): Response | Promise<Response>;
};

export type ComputeWork = () => Response | Promise<Response>;

function overloadedComputeResponse(): Response {
  return new Response("The app compute object is busy", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "1",
    },
  });
}

/**
 * Validate the single address supplied by the trusted legacy alias proxy.
 * Comma-separated forwarding chains and whitespace are rejected so the
 * downstream right-most-XFF policy cannot be confused by a second hop.
 */
export function isNarrowIp(value: string | null): value is string {
  if (!value || value.length > 45 || /\s|,/.test(value)) return false;
  return isIP(value) !== 0;
}

function normalizeForwardedHost(value: string | null): string | null {
  if (!value || value.length > 255 || /[\s,/?#@]/.test(value)) return null;

  try {
    const parsed = new URL(`https://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname
    ) {
      return null;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function hasMatchingProxySecret(
  expected: string | undefined,
  supplied: string | null,
): boolean {
  if (!expected || supplied === null) return false;

  // Hash both values first so timingSafeEqual always receives equal-length
  // byte arrays. The raw secret is never logged or copied into a response.
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function sanitizedClientIp(value: string | null): string | null {
  return isNarrowIp(value) ? value : null;
}

/**
 * Normalize the request at the public Worker boundary before it reaches
 * Next/OpenNext. The legacy alias lives in another Cloudflare account, so it
 * cannot rely on the platform's `cf-connecting-ip` to carry the browser's
 * address. It must prove possession of the shared secret before its original
 * IP/host headers are accepted.
 */
export function sanitizeIngressRequest(
  request: Request,
  env: Pick<AppWorkerEnvironment, "LEGACY_PROXY_SECRET">,
): Request {
  const headers = new Headers(request.headers);
  const requestHost = new URL(request.url).host;
  const proxySecret = request.headers.get(LEGACY_PROXY_SECRET_HEADER);
  const proxyIp = request.headers.get(LEGACY_PROXY_IP_HEADER);
  const proxyHost = request.headers.get("x-forwarded-host");
  const authenticatedProxy = hasMatchingProxySecret(
    env.LEGACY_PROXY_SECRET,
    proxySecret,
  );
  const trustedProxyIp = authenticatedProxy ? sanitizedClientIp(proxyIp) : null;
  const trustedProxyHost = authenticatedProxy
    ? normalizeForwardedHost(proxyHost)
    : null;
  const validLegacyProxy = trustedProxyIp !== null && trustedProxyHost !== null;

  // These headers are never forwarded verbatim, even when the proxy proof is
  // missing or malformed.
  headers.delete(LEGACY_PROXY_SECRET_HEADER);
  headers.delete(LEGACY_PROXY_IP_HEADER);
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.delete("x-forwarded-host");

  // Cloudflare owns cf-connecting-ip on a normal request. Do not trust a
  // browser-provided forwarding chain; feed the app one canonical hop.
  const platformIp = sanitizedClientIp(request.headers.get("cf-connecting-ip"));
  const clientIp = validLegacyProxy ? trustedProxyIp : platformIp;
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }

  const effectiveHost = validLegacyProxy ? trustedProxyHost : requestHost;
  headers.set("host", effectiveHost);
  headers.set("x-forwarded-host", effectiveHost);
  headers.set("x-forwarded-proto", new URL(request.url).protocol.slice(0, -1));

  // This constructor keeps the original URL, method, body stream, cookies,
  // abort signal, and other Fetch metadata while replacing only the headers.
  return new Request(request, { headers });
}

/**
 * Refuse excess work instead of allowing an object-local queue to grow
 * without bound. This guard does not retry or replay a request, which is
 * important for non-idempotent household writes.
 */
export function createComputeConcurrencyGuard(
  maxActive = APP_COMPUTE_POOL_MAX_ACTIVE,
) {
  if (maxActive !== APP_COMPUTE_POOL_MAX_ACTIVE) {
    throw new RangeError(
      `Each compute object must allow exactly ${APP_COMPUTE_POOL_MAX_ACTIVE} active requests`,
    );
  }

  let active = 0;

  return {
    async run(work: ComputeWork): Promise<Response> {
      if (active >= maxActive) return overloadedComputeResponse();

      active += 1;
      try {
        return await work();
      } finally {
        active -= 1;
      }
    },
  };
}

export function appComputePoolName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= APP_COMPUTE_POOL_SIZE) {
    throw new RangeError(
      `Compute pool index must be between 0 and ${APP_COMPUTE_POOL_SIZE - 1}`,
    );
  }
  return `${APP_COMPUTE_POOL_PREFIX}-${index}`;
}

/**
 * Create the public request router.
 *
 * The cursor is intentionally isolate-local and contains no household,
 * session, URL, or cookie data. The Durable Objects are compute-only: the
 * request body and application metadata are preserved while the ingress
 * forwarding headers are canonicalized. The app continues to use its
 * canonical D1/R2 bindings inside the OpenNext worker.
 */
export function createAppWorkerRouter(poolSize = APP_COMPUTE_POOL_SIZE) {
  if (poolSize !== APP_COMPUTE_POOL_SIZE) {
    throw new RangeError(
      `The app compute pool must contain exactly ${APP_COMPUTE_POOL_SIZE} objects`,
    );
  }

  let nextPoolIndex = 0;

  return {
    async fetch(
      request: Request,
      env: AppWorkerEnvironment,
    ): Promise<Response> {
      const namespace = env.APP_COMPUTE_POOL;
      if (!namespace) {
        return new Response("The app compute pool is unavailable", {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      const index = nextPoolIndex;
      nextPoolIndex = (nextPoolIndex + 1) % poolSize;
      const stub = namespace.get(
        namespace.idFromName(appComputePoolName(index)),
      );

      // Clone only to replace the ingress headers. The sanitizer preserves
      // cookies, auth headers, body streams, abort signals, and method while
      // preventing client-controlled forwarding metadata from reaching Next.
      return await stub.fetch(sanitizeIngressRequest(request, env));
    },
  };
}

/**
 * The generated OpenNext handler only needs waitUntil from the execution
 * context on this path. A narrow adapter avoids exposing Durable Object
 * storage or object lifecycle methods to application code.
 */
export async function forwardToOpenNext(
  worker: OpenNextWorker,
  request: Request,
  env: unknown,
  durableObjectContext: Pick<OpenNextExecutionContext, "waitUntil">,
): Promise<Response> {
  return await worker.fetch(request, env, {
    waitUntil: durableObjectContext.waitUntil.bind(durableObjectContext),
  });
}
