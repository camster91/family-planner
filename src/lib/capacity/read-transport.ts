/** Dormant fabricated-capacity read primitive. No import-time or factory HTTP,
 * database, provider, seed/reset, CLI or stage activation. */
import { assertFixtureTargetAllowed } from "../fixtures/guard";
import { assertLocalPerfTarget } from "../perf-target";
import { runOwnedForeground } from "../owned-request-http";
import { readBoundedJsonResponse } from "../bounded-json-response";

const ROUTES = ["/api/auth/me", "/api/capabilities", "/api/events", "/api/lists",
  "/api/chores", "/api/inventory", "/api/notifications", "/api/device/today"] as const;
export type CapacityReadRoute = typeof ROUTES[number];
export type CapacityReadReply = { kind: "reply"; status: number; data: unknown;
  /** Re-encoded admitted JSON, NOT compressed/wire/partial response bytes. */
  decodedJsonBytes: number; elapsedMs: number } | { kind: "unknown" };

/** One exact fabricated session per transport. Guards validate declared targets,
 * not actual server/database/session binding; adoption must establish those.
 * This primitive does not interpret HTTP success as a confirmed scenario.
 */
export function createCapacityReadTransport(input: {
  env?: Record<string, string | undefined>;
  cookie: string;
  request?: typeof fetch;
}) {
  // Retain the admitted target and credential even if caller-owned input/env is
  // changed during a stage. Nothing logs or returns cookies/database credentials.
  const env = { ...(input.env ?? process.env) };
  if (env.CAPACITY_ALLOW !== "local-fabricated-v1") throw new Error("Capacity adoption required");
  const origin = assertLocalPerfTarget(env.PERF_BASE_URL, env);
  assertFixtureTargetAllowed(env);
  const cookie = input.cookie;
  if (typeof cookie !== "string" || !cookie || cookie.length > 8192 || /[\r\n\0]/.test(cookie))
    throw new Error("A fabricated session is required");
  const request = input.request ?? fetch;
  return {
    async read(route: CapacityReadRoute, query: Readonly<Record<string, string>>, signal: AbortSignal): Promise<CapacityReadReply> {
      if (!(ROUTES as readonly string[]).includes(route)) throw new Error("Capacity read route unavailable");
      const url = new URL(route, origin);
      for (const [key, value] of Object.entries(query)) {
        if (typeof value !== "string" || !key || key.length > 128 || value.length > 2048)
          throw new Error("Invalid capacity query");
        url.searchParams.set(key, value);
      }
      if (url.href.length > 8192) throw new Error("Capacity query exceeded its bound");
      const began = performance.now();
      const result = await runOwnedForeground(async ownedSignal => {
        const response = await request(url.href, {
          method: "GET", cache: "no-store", redirect: "error", credentials: "omit",
          headers: { Cookie: cookie, Accept: "application/json" }, signal: ownedSignal,
        });
        if (ownedSignal.aborted) throw new Error("Capacity read aborted");
        // Node fetch's redirect:error is the dispatch barrier. This additional
        // admission rejects an incompatible/custom bridge's returned location;
        // it cannot recall credentials already sent by arbitrary adapter code.
        if (response.redirected || (response.url && new URL(response.url).origin !== origin))
          throw new Error("Capacity read redirected");
        const data = await readBoundedJsonResponse(response, ownedSignal, 8 * 1024 * 1024);
        if (ownedSignal.aborted) throw new Error("Capacity read aborted");
        return { kind: "reply" as const, status: response.status, data,
          decodedJsonBytes: new TextEncoder().encode(JSON.stringify(data)).byteLength,
          elapsedMs: performance.now() - began };
      }, { signal, timeoutMs: 15_000 });
      return result;
    },
  };
}
