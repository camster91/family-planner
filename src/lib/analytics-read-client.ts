import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { parseAnalyticsPayload } from "@/lib/analytics-presentation";

/** Bounded foreground display read. Neither failures nor malformed success
 * bodies become a believable empty household. No raw server errors are shown. */
export async function readHouseholdAnalytics(
  zoneQuery: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const result = await runOwnedForeground(async ownedSignal => {
    const response = await request(`/api/analytics?${zoneQuery}&projection=summary-v1`, {
      cache: "no-store", signal: ownedSignal,
    });
    if (!response.ok || ownedSignal.aborted) throw new Error("Analytics unavailable");
    const data = parseAnalyticsPayload(await readBoundedJsonResponse(response, ownedSignal, 2 * 1024 * 1024));
    if (!data) throw new Error("Invalid analytics response");
    return { kind: "analytics" as const, data };
  }, { signal, timeoutMs: 15_000 });
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  if (result.kind !== "analytics") throw new Error("Analytics could not load");
  return result.data;
}
