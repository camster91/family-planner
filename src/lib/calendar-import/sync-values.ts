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

export class CalendarSubscriptionSyncHeld extends Error {
  constructor(readonly reason: "access" | "source") { super("Calendar subscription refresh held"); }
}
