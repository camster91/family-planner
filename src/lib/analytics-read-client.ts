import { ANALYTICS_SUMMARY_PROJECTION, ANALYTICS_SUMMARY_LIMIT_CODE, hasCompleteAnalyticsCoverage, AnalyticsSummaryLimitError } from "@/lib/analytics-summary-contract";
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
    const response = await request(`/api/analytics?${zoneQuery}&projection=${ANALYTICS_SUMMARY_PROJECTION}`, {
      cache: "no-store", signal: ownedSignal,
    });
    if (ownedSignal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (response.status === 422) {
      const body = await readBoundedJsonResponse(response, ownedSignal, 16 * 1024);
      if (body && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).code === ANALYTICS_SUMMARY_LIMIT_CODE)
        return { kind: "limit" as const };
    }
    if (!response.ok) throw new Error("Analytics unavailable");
    const body = await readBoundedJsonResponse(response, ownedSignal, 2 * 1024 * 1024);
    if (!body || typeof body !== "object" || !hasCompleteAnalyticsCoverage((body as Record<string, unknown>).coverage))
      throw new Error("Analytics coverage unavailable");
    const data = parseAnalyticsPayload(body);
    if (!data) throw new Error("Invalid analytics response");
    return { kind: "analytics" as const, data };
  }, { signal, timeoutMs: 15_000 });
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  if (result.kind === "limit") throw new AnalyticsSummaryLimitError();
  if (result.kind !== "analytics") throw new Error("Analytics could not load");
  return result.data;
}
