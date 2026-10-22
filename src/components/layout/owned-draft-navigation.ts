"use client";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  navigateAfterOwnedDrafts,
  registerOwnedDraftExit,
} from "@/lib/owned-draft-exit";

export function useOwnedDraftExit(
  active: boolean,
  prepare: () => Promise<boolean>,
  release: () => Promise<boolean>,
) {
  const latest = useRef({ active, prepare, release });
  latest.current = { active, prepare, release };
  useEffect(
    () =>
      registerOwnedDraftExit({
        active: () => latest.current.active,
        prepare: () => latest.current.prepare(),
        release: () => latest.current.release(),
      }),
    [],
  );
}

/** App-owned push/replace/traversal must await active draft owners. Refresh and
 * prefetch do not leave a route. Explicit sign-out uses its existing raw router
 * after privacy cleanup, rather than waiting for a now-revoked draft owner.
 */
export function useDraftAwareRouter() {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        navigateAfterOwnedDrafts(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        navigateAfterOwnedDrafts(() => router.replace(...args)),
      back: () => navigateAfterOwnedDrafts(() => router.back()),
      forward: () => navigateAfterOwnedDrafts(() => router.forward()),
    }),
    [router],
  );
}
