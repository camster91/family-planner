"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type HistorySnapshot = {
  url: string;
  state: unknown;
  historyLength: number;
};

export type PendingFormNavigation = {
  releaseBeforeNavigation: () => Promise<void>;
};

const PendingFormNavigationContext =
  createContext<PendingFormNavigation | null>(null);

/**
 * Own one same-URL history sentinel while a form request is pending. The
 * sentinel gives the browser a same-route entry for the first Back traversal,
 * so Next's already-registered window listener cannot unmount the form before
 * this controller sees the event. Release consumes that owned entry and waits
 * for its same-URL pop before callers navigate to a destination.
 */
export function usePendingFormNavigationController(
  busy: boolean,
): PendingFormNavigation {
  const busyRef = useRef(busy);
  const entryRef = useRef<HistorySnapshot | null>(null);
  const releasePromiseRef = useRef<Promise<void> | null>(null);
  const releaseResolveRef = useRef<(() => void) | null>(null);
  const disarmedRef = useRef(false);
  const restoringRef = useRef(false);
  const cleanupTimerRef = useRef<number | null>(null);

  busyRef.current = busy;

  const finishRelease = useCallback(() => {
    entryRef.current = null;
    disarmedRef.current = false;
    restoringRef.current = false;
    const resolve = releaseResolveRef.current;
    releaseResolveRef.current = null;
    releasePromiseRef.current = null;
    resolve?.();
  }, []);

  const releaseBeforeNavigation = useCallback(() => {
    const entry = entryRef.current;
    if (!entry) return Promise.resolve();
    if (releasePromiseRef.current) return releasePromiseRef.current;

    disarmedRef.current = true;
    releasePromiseRef.current = new Promise<void>((resolve) => {
      releaseResolveRef.current = resolve;
    });

    // If Next or another owner already moved away from our URL, there is no
    // sentinel left to consume. Never issue a second back into that route.
    const ownsCurrentEntry =
      window.location.href === entry.url &&
      window.history.length === entry.historyLength;
    if (!ownsCurrentEntry) finishRelease();
    else window.history.back();
    return releasePromiseRef.current;
  }, [finishRelease]);

  // Keep one window listener for the lifetime of this form. A capture-phase
  // listener alone cannot outrank Next's earlier window listener because both
  // listeners run at the Window target; the same-URL sentinel is what keeps
  // Next on this route until this listener can re-arm it.
  useEffect(() => {
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    const onPopState = (event: PopStateEvent) => {
      const entry = entryRef.current;
      if (!entry) return;

      if (disarmedRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishRelease();
        return;
      }
      if (restoringRef.current) {
        restoringRef.current = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!busyRef.current) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      // Traverse back to the exact entry below our sentinel, then immediately
      // traverse forward to the owned sentinel. This preserves history length
      // and avoids manufacturing a new ghost entry on every Back press.
      restoringRef.current = true;
      window.history.forward();
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!busyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    // Keep capture enabled for browser implementations that dispatch window
    // listeners in phase order; the sentinel handles Next's same-target order.
    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // A destination navigation should have awaited release. If an external
      // unmount wins the race, consume only our current same-URL sentinel.
      // Deferring one task keeps React StrictMode's setup/cleanup probe from
      // consuming a legitimate sentinel between its two effect setups.
      const entry = entryRef.current;
      cleanupTimerRef.current = window.setTimeout(() => {
        cleanupTimerRef.current = null;
        if (entryRef.current !== entry) return;
        // A release already owns the pending traversal. Let its popstate
        // settle the promise; issuing another back here could skip the
        // destination if the browser has not dispatched the first pop yet.
        if (disarmedRef.current || releasePromiseRef.current) return;
        if (
          entry &&
          window.location.href === entry.url &&
          window.history.length === entry.historyLength
        ) {
          disarmedRef.current = true;
          restoringRef.current = false;
          window.history.back();
        }
        finishRelease();
      }, 0);
    };
  }, [finishRelease]);

  useEffect(() => {
    if (busy) {
      if (entryRef.current || releasePromiseRef.current) return;
      const state = window.history.state;
      const entry = {
        url: window.location.href,
        state,
        historyLength: window.history.length + 1,
      };
      window.history.pushState(state, "", entry.url);
      entryRef.current = entry;
      return;
    }
    void releaseBeforeNavigation();
  }, [busy, releaseBeforeNavigation]);

  return { releaseBeforeNavigation };
}

export function usePendingFormNavigation(): PendingFormNavigation | null {
  return useContext(PendingFormNavigationContext);
}

export function PendingFormNavigationProvider({
  value,
  children,
}: {
  value: PendingFormNavigation;
  children: ReactNode;
}) {
  return (
    <PendingFormNavigationContext.Provider value={value}>
      {children}
    </PendingFormNavigationContext.Provider>
  );
}
