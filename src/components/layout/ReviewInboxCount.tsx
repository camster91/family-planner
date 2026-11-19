"use client";

import { useEffect, useState } from "react";
import { BELL_COUNT_MAX, bellCountLabel } from "./BellUnreadDot";

/**
 * How many finished chores are waiting for a parent's check, for the review
 * inbox icon in the top bar. These are the inbox's "Checks" items: the same
 * household-scoped `GET /api/chores?status=completed` read the chores page
 * uses (parents only; the icon is only shown to parents). Re-checked on each
 * page change. A failed read, or chores switched off, shows no badge.
 * Capped at BELL_COUNT_MAX + 1 ("9+").
 */
export function useReviewCount(enabled: boolean, pathname: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || typeof fetch !== "function") return;
    const controller = new AbortController();
    const limit = BELL_COUNT_MAX + 1;
    Promise.resolve()
      .then(() => fetch(`/api/chores?status=completed&limit=${limit}&order=asc`, { cache: "no-store", signal: controller.signal }))
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { chores?: unknown[] } | null) => {
        if (!controller.signal.aborted) setCount(Array.isArray(body?.chores) ? Math.min(body.chores.length, limit) : 0);
      })
      .catch(() => { if (!controller.signal.aborted) setCount(0); });
    return () => controller.abort();
  }, [enabled, pathname]);
  return enabled ? count : 0;
}

/** The count badge on the review inbox icon. The link's name carries the count. */
export function ReviewInboxBadge({ pathname, onCount }: { pathname: string | null; onCount: (count: number) => void }) {
  const count = useReviewCount(true, pathname);
  useEffect(() => { onCount(count); }, [count, onCount]);
  if (count <= 0) return null;
  return (
    <span data-testid="review-inbox-count" aria-hidden="true"
      className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--surface-base)]">
      {bellCountLabel(count)}
    </span>
  );
}
