"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { newIdempotencyKey } from "@/lib/idempotency-key";

type HistorySnapshot = {
  url: string;
  state: unknown;
  token: string;
};

export type PendingFormNavigation = {
  releaseBeforeNavigation: () => Promise<void>;
};

const SENTINEL_KEY = "__herewovenPendingForm";

function ownsEntry(
  entry: HistorySnapshot,
  state: unknown = window.history.state,
) {
  return (
    window.location.href === entry.url &&
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[SENTINEL_KEY] === entry.token
  );
}

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
    const promise = releasePromiseRef.current;
    if (restoringRef.current) {
      // A pending Back already requested Forward. Its pop will consume the
      // marked sentinel before resolving; never traverse Back from its base.
      return promise;
    }
    if (!ownsEntry(entry)) finishRelease();
    else window.history.back();
    return promise;
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
        restoringRef.current = false;
        if (ownsEntry(entry, event.state)) window.history.back();
        else finishRelease();
        return;
      }
      if (restoringRef.current && ownsEntry(entry, event.state)) {
        restoringRef.current = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!busyRef.current || ownsEntry(entry, event.state)) return;

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
        if (entry && ownsEntry(entry)) {
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
        token: newIdempotencyKey(),
      };
      // Preserve Next's tree/identity fields, with a unique ownership marker
      // so the same-URL base entry can never be mistaken for this sentinel.
      window.history.pushState(
        { ...state, [SENTINEL_KEY]: entry.token },
        "",
        entry.url,
      );
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
