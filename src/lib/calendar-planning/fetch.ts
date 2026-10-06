import type { EventOrigin } from "./view";
export interface PlanningEvent extends EventOrigin {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  event_type: string;
  description?: string | null;
  location?: string | null;
  recurrence?: string | null;
}
export async function fetchPlanningRange(
  start: string,
  end: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  maxPages = 10,
) {
  const events = new Map<string, PlanningEvent>();
  const seen = new Set<string>();
  let pages = 0;
  let cursor: string | null = null;
  do {
    if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
    const query = new URLSearchParams({ start, end, limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const response = await request(`/api/events?${query}`, { signal });
    if (!response.ok) throw new Error("Calendar could not load. Try again.");
    const body = await response.json();
    if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (!Array.isArray(body.events) || typeof body.hasMore !== "boolean")
      throw new Error("Invalid calendar paging response.");
    for (const event of body.events) events.set(event.id, event);
    cursor = body.hasMore ? body.nextCursor : null;
    if (
      body.hasMore &&
      (typeof cursor !== "string" || !cursor || seen.has(cursor))
    )
      throw new Error("Invalid calendar paging response.");
    if (cursor) seen.add(cursor);
    pages++;
    if (cursor && pages >= maxPages)
      return { events: [...events.values()], truncated: true };
  } while (cursor);
  return { events: [...events.values()], truncated: false };
}
