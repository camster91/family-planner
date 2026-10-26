/** Dormant canonical calendar-range case, not the complete calendar scenario. */
import { fetchPlanningRange } from "../calendar-planning/fetch";
import { CALENDAR_OWNER_HEADER, calendarOwnerSchema } from "../calendar-read-owner";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "../calendar-planning/instant";
import type { CapacityIntent } from "./model";
import type { createCapacityReadTransport } from "./read-transport";

type Transport = ReturnType<typeof createCapacityReadTransport>;
export type CapacityCalendarReadResult = {
  outcome: "confirmed" | "refused" | "unknown" | "failed" | "unsafe";
  requests: number; decodedJsonBytes: number; events: number; truncated: boolean;
};
/** Caller must bind the exact fabricated cookie/session, fixture IDs and range
 * to this original ordinal/role. IDs and owner assertions do not authenticate.
 * No login, provider, write, seed/reset, CLI or runner wiring is performed here.
 */
export function createCapacityCalendarReadCase(input: {
  transport: Transport;
  owner: unknown;
  householdOrdinal: number;
  start: string;
  end: string;
  expectedEventIds: readonly string[];
}) {
  const owner = Object.freeze(calendarOwnerSchema.parse(input.owner));
  const transport = input.transport;
  const ordinal = input.householdOrdinal;
  const start = input.start, end = input.end;
  const from = parseCalendarInstant(start).getTime(), until = parseCalendarInstant(end).getTime();
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= 50 ||
    !["parent", "teen", "child"].includes(owner.role) || until <= from || until - from > CALENDAR_RANGE_MAX_MS ||
    !Array.isArray(input.expectedEventIds) || input.expectedEventIds.length > 10_000 ||
    input.expectedEventIds.some(id => typeof id !== "string" || !id || id.length > 128))
    throw new Error("Invalid fabricated calendar case");
  const expected = new Set(input.expectedEventIds);
  if (expected.size !== input.expectedEventIds.length) throw new Error("Duplicate calendar fixture identity");
  return async (intent: CapacityIntent, signal: AbortSignal): Promise<CapacityCalendarReadResult> => {
    if (intent.scenario !== "calendar" || intent.shared || intent.householdOrdinal !== ordinal || intent.role !== owner.role)
      throw new Error("Calendar case does not match its fabricated session");
    let requests = 0, decodedJsonBytes = 0;
    let stopped: CapacityCalendarReadResult["outcome"] | null = null;
    // Adapt the guarded parsed reply to the actual browser range reader rather
    // than inventing a second paging/schema/overlap/cursor implementation.
    // This reconstruction adds client-side JSON encoding/decoding overhead;
    // request amplification is real, but no wire-byte/server latency claim follows.
    const request = (async (target: RequestInfo | URL, init?: RequestInit) => {
      if (typeof target !== "string" || !target.startsWith("/api/events?") || (init?.method ?? "GET") !== "GET")
        throw new Error("Unexpected calendar case request");
      const query = new URL(target, "http://capacity.invalid").searchParams;
      if (query.get("start") !== start || query.get("end") !== end || query.get("limit") !== "200" ||
        [...query.keys()].some(key => !["start", "end", "limit", "cursor"].includes(key)))
        throw new Error("Calendar case range changed");
      requests++;
      const result = await transport.read("/api/events", Object.fromEntries(query), init?.signal ?? signal, owner);
      if (result.kind !== "reply") {
        stopped = result.kind === "owner-mismatch" ? "unsafe" : result.kind === "owner-unavailable" ? "failed" : "unknown";
        throw new Error("Calendar read unavailable");
      }
      decodedJsonBytes += result.decodedJsonBytes;
      if (result.status < 200 || result.status >= 300) {
        stopped = [401, 403, 409, 429].includes(result.status) ? "refused" : "failed";
        throw new Error("Calendar read refused");
      }
      return new Response(JSON.stringify(result.data), { status: result.status,
        headers: result.calendarOwner ? { [CALENDAR_OWNER_HEADER]: JSON.stringify(result.calendarOwner) } : {} });
    }) as typeof fetch;
    try {
      const result = await fetchPlanningRange(start, end, signal, request, 10, { owner });
      if (result.events.some(event => !expected.has(event.id)))
        return { outcome: "unsafe", requests, decodedJsonBytes, events: 0, truncated: result.truncated };
      if (result.truncated)
        return { outcome: "unknown", requests, decodedJsonBytes, events: result.events.length, truncated: true };
      // Exact expected membership catches omitted rows as well as foreign IDs.
      const complete = result.events.length === expected.size;
      return { outcome: complete ? "confirmed" : "failed", requests, decodedJsonBytes, events: result.events.length, truncated: false };
    } catch {
      return { outcome: stopped ?? "unknown", requests, decodedJsonBytes, events: 0, truncated: false };
    }
  };
}
