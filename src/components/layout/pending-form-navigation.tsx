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
import {
  getPendingFormNavigationBootstrap,
  type PendingFormNavigationNavigateHandler,
  type PendingFormNavigationPopStateHandler,
} from "@/lib/pending-form-navigation-bootstrap";

type HistorySnapshot = {
  url: string;
  state: unknown;
  token: string;
};
type RestorationTarget = "sentinel" | "base-then-sentinel" | null;

function sameHistoryState(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isBaseEntry(
  entry: HistorySnapshot,
  state: unknown = window.history.state,
) {
  return window.location.href === entry.url && sameHistoryState(state, entry.state);
}

export type PendingFormNavigation = {
  releaseBeforeNavigation: () => Promise<boolean>;
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
  const mountedRef = useRef(true);
  const busyRef = useRef(busy);
  const entryRef = useRef<HistorySnapshot | null>(null);
  const releasePromiseRef = useRef<Promise<boolean> | null>(null);
  const releaseResolveRef = useRef<((allowed: boolean) => void) | null>(null);
  const releaseStartedWhileBusyRef = useRef(false);
  const disarmedRef = useRef(false);
  const restoringRef = useRef(false);
  const restorationTargetRef = useRef<RestorationTarget>(null);
  const consumingRef = useRef(false);
  const cleanupTimerRef = useRef<number | null>(null);

  busyRef.current = busy;

  const finishRelease = useCallback((allowed = true) => {
    const entry = entryRef.current;
    entryRef.current = null;
    disarmedRef.current = false;
    restoringRef.current = false;
    restorationTargetRef.current = null;
    consumingRef.current = false;
    const resolve = releaseResolveRef.current;
    releaseResolveRef.current = null;
    releasePromiseRef.current = null;
    const releaseStartedWhileBusy = releaseStartedWhileBusyRef.current;
    releaseStartedWhileBusyRef.current = false;

    // A failed request can be retried while its automatic release traversal
    // is still in flight. Re-arm against the exact base entry only after that
    // traversal settles; never push into a foreign or newer owner's entry.
    if (
      allowed &&
      mountedRef.current &&
      busyRef.current &&
      !releaseStartedWhileBusy &&
      entry &&
      isBaseEntry(entry)
    ) {
      const state = window.history.state;
      const nextEntry = {
        url: window.location.href,
        state,
        token: newIdempotencyKey(),
      };
      window.history.pushState(
        { ...state, [SENTINEL_KEY]: nextEntry.token },
        "",
        nextEntry.url,
      );
      entryRef.current = nextEntry;
    }

    resolve?.(allowed);
  }, []);

  const releaseBeforeNavigation = useCallback(() => {
    if (!mountedRef.current) return Promise.resolve(false);
    const entry = entryRef.current;
    if (!entry) return Promise.resolve(true);
    if (releasePromiseRef.current) {
      // An authorized success/close can join an automatic idle release after
      // a retry becomes busy. Suppress re-arm for that shared release so the
      // caller can navigate without inheriting a ghost sentinel.
      if (busyRef.current) releaseStartedWhileBusyRef.current = true;
      return releasePromiseRef.current;
    }

    releaseStartedWhileBusyRef.current = busyRef.current;
    disarmedRef.current = true;
    releasePromiseRef.current = new Promise<boolean>((resolve) => {
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
    if (ownsEntry(entry)) {
      consumingRef.current = true;
      window.history.back();
    } else if (isBaseEntry(entry)) {
      // The sentinel was already consumed by a prior Back. Resolve only for
      // the exact same-URL base state, never for an arbitrary foreign entry.
      finishRelease(true);
    } else {
      // A foreign traversal raced release. Restore the sentinel first; its
      // pop will enter the consuming branch below.
      restoringRef.current = true;
      restorationTargetRef.current = "base-then-sentinel";
      window.history.forward();
    }
    return promise;
  }, [finishRelease]);

  const onPopState = useCallback<PendingFormNavigationPopStateHandler>(
    (event) => {
      const entry = entryRef.current;
      if (!entry) return false;

      if (disarmedRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (restoringRef.current) {
          if (ownsEntry(entry, event.state)) {
            restoringRef.current = false;
            restorationTargetRef.current = null;
            consumingRef.current = true;
            window.history.back();
          } else if (isBaseEntry(entry, event.state)) {
            if (restorationTargetRef.current === "base-then-sentinel") {
              restorationTargetRef.current = "sentinel";
              window.history.forward();
            }
          } else {
            // A second Back can reach a foreign prior entry before the first
            // Forward finishes. Restore again rather than resolving against a
            // state that does not belong to this form's history slot.
            restorationTargetRef.current = "base-then-sentinel";
            window.history.forward();
          }
          return true;
        }
        if (consumingRef.current) {
          if (isBaseEntry(entry, event.state)) {
            consumingRef.current = false;
            finishRelease(true);
          } else {
            // The Back intended to consume our sentinel landed on a foreign
            // entry. Drain back to the sentinel before resolving release.
            consumingRef.current = false;
            restoringRef.current = true;
            restorationTargetRef.current = "base-then-sentinel";
            window.history.forward();
          }
          return true;
        }
        if (ownsEntry(entry, event.state)) {
          consumingRef.current = true;
          window.history.back();
        } else if (isBaseEntry(entry, event.state)) {
          finishRelease(true);
        } else {
          restoringRef.current = true;
          restorationTargetRef.current = "base-then-sentinel";
          window.history.forward();
        }
        return true;
      }
      if (restoringRef.current) {
        if (ownsEntry(entry, event.state)) {
          restoringRef.current = false;
          restorationTargetRef.current = null;
        } else if (isBaseEntry(entry, event.state)) {
          if (restorationTargetRef.current === "base-then-sentinel") {
            restorationTargetRef.current = "sentinel";
            window.history.forward();
          }
        } else {
          // The initial Back should report the exact base state. If a rapid
          // second Back reports an older foreign entry, restore the sentinel
          // again; ignoring that pop would let the pending form escape.
          restorationTargetRef.current = "base-then-sentinel";
          window.history.forward();
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
      if (!busyRef.current || ownsEntry(entry, event.state)) return false;

      event.preventDefault();
      event.stopImmediatePropagation();
      // Traverse back to the exact entry below our sentinel, then immediately
      // traverse forward to the owned sentinel. This preserves history length
      // and avoids manufacturing a new ghost entry on every Back press.
      restoringRef.current = true;
      restorationTargetRef.current = isBaseEntry(entry, event.state)
        ? "sentinel"
        : "base-then-sentinel";
      window.history.forward();
      return true;
    },
    [finishRelease],
  );

  const onNavigate = useCallback<PendingFormNavigationNavigateHandler>(
    (event) => {
      if (
        event.navigationType !== "traverse" ||
        !event.cancelable ||
        event.destination?.sameDocument !== true ||
        !busyRef.current ||
        disarmedRef.current
      ) {
        return false;
      }
      const entry = entryRef.current;
      // A committed fallback traversal may already be restoring the sentinel.
      // Let that controller-owned Forward/Back reach popstate; only cancel
      // while the current entry is still the one owned by this form.
      return entry ? ownsEntry(entry) : false;
    },
    [],
  );

  // Keep the beforeunload warning local to this form. Popstate uses the
  // document-head dispatcher above, which was installed before Next's router
  // listener and therefore can stop same-document navigation before it
  // unmounts the form.
  useEffect(() => {
    mountedRef.current = true;
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!busyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const bootstrap = getPendingFormNavigationBootstrap();
    const unregister = bootstrap
      ? bootstrap.register(onPopState)
      : (() => {
          window.addEventListener("popstate", onPopState, true);
          return () => window.removeEventListener("popstate", onPopState, true);
        })();
    const unregisterNavigate =
      bootstrap?.registerNavigate?.(onNavigate) ?? (() => {});
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      mountedRef.current = false;
      unregisterNavigate();
      unregister();
      window.removeEventListener("beforeunload", onBeforeUnload);
      // A destination navigation should have awaited release. If an external
      // unmount wins the race, consume only our current same-URL sentinel.
      // Deferring one task keeps React StrictMode's setup/cleanup probe from
      // consuming a legitimate sentinel between its two effect setups.
      const entry = entryRef.current;
      cleanupTimerRef.current = window.setTimeout(() => {
        cleanupTimerRef.current = null;
        if (entryRef.current !== entry) return;
        // The listener has gone: settle any pending caller as cancelled.
        // Do not issue a second traversal while Back/Forward is in flight.
        if (
          disarmedRef.current ||
          releasePromiseRef.current ||
          restoringRef.current
        ) {
          finishRelease(false);
          return;
        }
        if (entry && ownsEntry(entry)) {
          disarmedRef.current = true;
          restoringRef.current = false;
          restorationTargetRef.current = null;
          window.history.back();
        }
        finishRelease(false);
      }, 0);
    };
  }, [finishRelease, onNavigate, onPopState]);

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
