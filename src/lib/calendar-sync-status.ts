/**
 * Words for a calendar connection's sync state (#271), shared by Settings →
 * Connected calendars (provider sync, #264) and Subscribed calendars (#232).
 *
 * Uses the existing fields only: `last_synced_at` / `last_fetched_at` record
 * the last attempt (successful or not) and `status` / `last_status` say how it
 * went, so a success reads "Last synced 3 min ago" and a failure reads the
 * stored fixed-vocabulary message plus "Last tried 3 min ago". Never a bare
 * timestamp, never colour alone (callers prefix problems with "Problem:").
 */
import { formatRelativeTime, type RelativeTimeMessages } from "./relative-time";

/** Optional presentation only; the default helper contract remains English. */
export interface CalendarSyncMessages {
  relativeTime: RelativeTimeMessages;
  waiting: (verb: "synced" | "updated") => string;
  last: (verb: "synced" | "updated", ago: string) => string;
  tried: (message: string, ago: string) => string;
}

export interface SyncDescription {
  /** True when the last attempt failed or needs the member's action. */
  problem: boolean;
  text: string;
}

export function describeCalendarSync({
  lastAttemptAt,
  failed,
  error,
  now,
  verb,
  failedFallback,
  messages,
}: {
  /** ISO time of the last attempt, or null before the first one. */
  lastAttemptAt: string | null;
  failed: boolean;
  /** Stored short message (fixed vocabulary), if any. */
  error: string | null;
  now: number;
  /** "synced" (two-way sync) or "updated" (subscribed feed). */
  verb: "synced" | "updated";
  /** Shown when a failure has no stored message. */
  failedFallback: string;
  messages?: CalendarSyncMessages;
}): SyncDescription {
  const ago = lastAttemptAt
    ? formatRelativeTime(lastAttemptAt, now, messages?.relativeTime)
    : null;
  if (failed) {
    const message = (error?.trim() || failedFallback).replace(/\.?$/, ".");
    return {
      problem: true,
      text: ago
        ? messages
          ? messages.tried(message, ago)
          : `${message} Last tried ${ago}.`
        : message,
    };
  }
  if (!ago)
    return {
      problem: false,
      text: messages
        ? messages.waiting(verb)
        : verb === "synced"
          ? "Waiting for first sync."
          : "Waiting for first refresh.",
    };
  const base = messages ? messages.last(verb, ago) : `Last ${verb} ${ago}.`;
  // A successful refresh can still carry a note (e.g. a very large feed was trimmed).
  return {
    problem: false,
    text: error?.trim() ? `${base} ${error.trim().replace(/\.?$/, ".")}` : base,
  };
}
