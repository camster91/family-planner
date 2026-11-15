const DAY_MS = 24 * 60 * 60 * 1000;
export const IMPORT_WINDOW_PAST_DAYS = 30;
export const IMPORT_WINDOW_FUTURE_DAYS = 180;
export const STALE_AFTER_MS = 15 * 60 * 1000;
export { MAX_SUBSCRIPTIONS_PER_FAMILY } from "@/lib/calendar-subscription-list";

export type SubscriptionStatus = "pending" | "ok" | "error";

export interface SyncResult {
  status: "ok" | "not_modified" | "error";
  created: number;
  updated: number;
  deleted: number;
  error?: string;
}


export function importWindow(now: Date): { start: Date; end: Date } {
  return { start: new Date(now.getTime() - IMPORT_WINDOW_PAST_DAYS * DAY_MS), end: new Date(now.getTime() + IMPORT_WINDOW_FUTURE_DAYS * DAY_MS) };
}

/**
 * Whether a refresh may ask the feed server "has it changed?" (ETag /
 * Last-Modified). The import window moves with the clock, so an unchanged
 * feed still has to be read in full now and then or its later repeats are
 * never written. The first refresh of each UTC day reads it in full.
 */
export function mayUseFeedValidators(lastFetchedAt: Date | number | null | undefined, now: Date): boolean {
  if (lastFetchedAt === null || lastFetchedAt === undefined) return false;
  const last = typeof lastFetchedAt === "number" ? lastFetchedAt : lastFetchedAt.getTime();
  return Number.isFinite(last) && Math.floor(last / DAY_MS) === Math.floor(now.getTime() / DAY_MS);
}

export class CalendarSubscriptionSyncHeld extends Error {
  constructor(readonly reason: "access" | "source") { super("Calendar subscription refresh held"); }
}
