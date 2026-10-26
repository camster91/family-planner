import { z } from "zod";
import { runOwnedForeground } from "@/lib/owned-request-http";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS, CALENDAR_RANGE_MAX_LIMIT } from "./instant";
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
const instant = z.string().refine(value => {
  try { parseCalendarInstant(value); return true; } catch { return false; }
});
const event = z.object({
  id: z.string().min(1).max(128), title: z.string(), start_time: instant, end_time: instant,
  event_type: z.string(), description: z.string().nullable().optional(), location: z.string().nullable().optional(),
  recurrence: z.string().nullable().optional(), source_subscription_id: z.string().nullable().optional(),
  source_connection_id: z.string().nullable().optional(),
  source: z.object({ subscription_id: z.string(), name: z.string(), color: z.string().nullable() }).nullable().optional(),
}).refine(row => Date.parse(row.end_time) >= Date.parse(row.start_time));
const page = z.object({ events: z.array(event).max(CALENDAR_RANGE_MAX_LIMIT), hasMore: z.boolean(),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).nullable().optional(),
}).refine(value => new Set(value.events.map(row => row.id)).size === value.events.length &&
  (value.hasMore ? typeof value.nextCursor === "string" && value.events.length > 0 : value.nextCursor == null));
class InvalidCalendarPage extends Error {}
/** Entire range job has one deadline, including every page and body read.
 * The explicit ten-page/2000-row budget retains the existing truncation signal.
 */
export async function fetchPlanningRange(
  start: string,
  end: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  maxPages = 10,
) {
  const from = parseCalendarInstant(start).getTime(), until = parseCalendarInstant(end).getTime();
  if (until <= from || until - from > CALENDAR_RANGE_MAX_MS || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10)
    throw new Error("Invalid calendar paging request.");
  const result = await runOwnedForeground(async ownedSignal => {
    const events = new Map<string, PlanningEvent>();
    const seen = new Set<string>();
    let pages = 0;
    let cursor: string | null = null;
    try {
      do {
        if (ownedSignal.aborted) throw new DOMException("Request aborted", "AbortError");
        const query = new URLSearchParams({ start, end, limit: "200" });
        if (cursor) query.set("cursor", cursor);
        const response = await request(`/api/events?${query}`, { cache: "no-store", signal: ownedSignal });
        if (!response.ok || ownedSignal.aborted) throw new Error("Calendar unavailable");
        // Retain large valid 200-event pages, while bounding untrusted streams.
        const parsed = page.safeParse(await readBoundedJsonResponse(response, ownedSignal, 8 * 1024 * 1024));
        if (!parsed.success) throw new InvalidCalendarPage();
        if (ownedSignal.aborted) throw new DOMException("Request aborted", "AbortError");
        for (const row of parsed.data.events) {
          const begins = Date.parse(row.start_time), ends = Date.parse(row.end_time);
          if (!((begins >= from && begins < until) || (begins < from && ends > from))) throw new InvalidCalendarPage();
          events.set(row.id, row);
        }
        cursor = parsed.data.hasMore ? parsed.data.nextCursor! : null;
        if (cursor && seen.has(cursor)) throw new InvalidCalendarPage();
        if (cursor) seen.add(cursor);
        pages++;
        if (cursor && pages >= maxPages) return { kind: "range" as const, events: [...events.values()], truncated: true };
      } while (cursor);
      return { kind: "range" as const, events: [...events.values()], truncated: false };
    } catch (cause) {
      if (cause instanceof InvalidCalendarPage) return { kind: "invalid" as const };
      throw cause;
    }
  }, { signal, timeoutMs: 30_000 });
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  if (result.kind === "invalid") throw new Error("Invalid calendar paging response.");
  if (result.kind !== "range") throw new Error("Calendar could not load. Try again.");
  return { events: result.events, truncated: result.truncated };
}
