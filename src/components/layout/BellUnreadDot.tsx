"use client";

import { useEffect, useState } from "react";
import { NOTIFICATIONS_CHANGED_EVENT, reminderTimeZoneHeaders } from "@/lib/notification-events";
import { BELL_COUNT_MAX, bellCountLabel } from "./badge-count";

export { BELL_COUNT_MAX, bellCountLabel };

/**
 * How many unread notifications the signed-in person has, for the bell. Every
 * unread notification counts (messages, chores, reminders...), not only event
 * reminders. When reminders are on, reading the inbox is also what writes due
 * reminders, since there is no scheduler. Any failure simply shows no badge.
 * Capped at BELL_COUNT_MAX + 1.
 */
export function useBellUnread(enabled: boolean, pathname: string | null): number {
  const [unread, setUnread] = useState(0);
  // Bumped when the inbox page says something was read, snoozed or removed.
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const changed = () => setChanges((count) => count + 1);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || typeof fetch !== "function") return;
    const controller = new AbortController();
    // Promise-wrapped so a fetch stub that returns nothing cannot throw here.
    Promise.resolve()
      .then(() => fetch(`/api/notifications?unread=true&limit=${BELL_COUNT_MAX + 1}`, { cache: "no-store", signal: controller.signal, headers: reminderTimeZoneHeaders() }))
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { notifications?: unknown[] } | null) => {
        if (!controller.signal.aborted) setUnread(Array.isArray(body?.notifications) ? Math.min(body.notifications.length, BELL_COUNT_MAX + 1) : 0);
      })
      // A failed count shows no badge rather than a stale one.
      .catch(() => { if (!controller.signal.aborted) setUnread(0); });
    return () => controller.abort();
    // Re-check on each page change and inbox change: that is when a person may have read or received one.
  }, [enabled, pathname, changes]);
  return enabled ? unread : 0;
}

export function BellUnreadDot({ count }: { count: number }) {
  return (
    <span data-testid="bell-unread-dot" aria-hidden="true"
      className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--surface-base)]">
      {bellCountLabel(count)}
    </span>
  );
}

/** The bell's badge, loaded on demand by the top bar: counts unread rows and reports the count for the bell's name. */
export function BellUnreadBadge({ pathname, onCount }: { pathname: string | null; onCount: (count: number) => void }) {
  const count = useBellUnread(true, pathname);
  useEffect(() => { onCount(count); }, [count, onCount]);
  return count > 0 ? <BellUnreadDot count={count} /> : null;
}
