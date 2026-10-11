"use client";

import { useEffect, useRef } from "react";

type HistorySnapshot = {
  url: string;
  state: unknown;
};

/**
 * Keep an in-flight form request on its current route. This is shared by the
 * intercepted form sheet and direct form fallbacks so browser Back cannot
 * unmount a request whose response still owns the draft and idempotency key.
 */
export function usePendingFormNavigationGuard(busy: boolean) {
  const snapshotRef = useRef<HistorySnapshot | null>(null);

  useEffect(() => {
    if (!busy) {
      snapshotRef.current = null;
      return;
    }

    snapshotRef.current = {
      url: window.location.href,
      state: window.history.state,
    };

    const onPopState = (event: PopStateEvent) => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Back has already moved the browser to the previous entry. Reinsert
      // this exact URL/state as the current entry without emitting another
      // popstate event, so repeated Back presses remain safely blocked.
      window.history.pushState(snapshot.state, "", snapshot.url);
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      snapshotRef.current = null;
    };
  }, [busy]);
}
