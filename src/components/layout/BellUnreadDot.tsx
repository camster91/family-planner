"use client";

import { useEffect, useState } from "react";
import { reminderTimeZoneHeaders } from "@/lib/notification-read-client";

/**
 * Whether the signed-in person has an unread notification, for the bell
 * (event reminders, default-off). Reading the inbox is also what writes due
 * reminders, since there is no scheduler. Mounted only when the server says
 * reminders are on; any failure simply shows no dot.
 */
export function useBellUnread(enabled: boolean, pathname: string | null): boolean {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/notifications?unread=true&limit=1", { cache: "no-store", signal: controller.signal, headers: reminderTimeZoneHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { notifications?: unknown[] } | null) => {
        if (!controller.signal.aborted) setUnread(Array.isArray(body?.notifications) && body.notifications.length > 0);
      })
      .catch(() => {});
    return () => controller.abort();
    // Re-check on each page change: that is when a person may have read or received one.
  }, [enabled, pathname]);
  return enabled && unread;
}

export function BellUnreadDot() {
  return <span data-testid="bell-unread-dot" aria-hidden="true" className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface-base)]" />;
}
