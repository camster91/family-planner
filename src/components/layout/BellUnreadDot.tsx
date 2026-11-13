"use client";

import { useEffect, useState } from "react";
import { reminderTimeZoneHeaders } from "@/lib/notification-read-client";

/** The badge shows exact counts up to this; one more unread row reads as "9+". */
export const BELL_COUNT_MAX = 9;

/**
 * How many unread notifications the signed-in person has, for the bell
 * (event reminders). Reading the inbox is also what writes due reminders,
 * since there is no scheduler. Asks only when the server says reminders are
 * on; any failure simply shows no badge. Capped at BELL_COUNT_MAX + 1.
 */
export function useBellUnread(enabled: boolean, pathname: string | null): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/notifications?unread=true&limit=${BELL_COUNT_MAX + 1}`, { cache: "no-store", signal: controller.signal, headers: reminderTimeZoneHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { notifications?: unknown[] } | null) => {
        if (!controller.signal.aborted) setUnread(Array.isArray(body?.notifications) ? Math.min(body.notifications.length, BELL_COUNT_MAX + 1) : 0);
      })
      .catch(() => {});
    return () => controller.abort();
    // Re-check on each page change: that is when a person may have read or received one.
  }, [enabled, pathname]);
  return enabled ? unread : 0;
}

/** What the badge and the bell's name say for a count from useBellUnread. */
export const bellCountLabel = (count: number) => (count > BELL_COUNT_MAX ? `${BELL_COUNT_MAX}+` : String(count));

export function BellUnreadDot({ count }: { count: number }) {
  return (
    <span data-testid="bell-unread-dot" aria-hidden="true"
      className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--surface-base)]">
      {bellCountLabel(count)}
    </span>
  );
}
