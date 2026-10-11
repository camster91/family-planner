"use client";

import * as React from "react";
import {
  defaultFeatures,
  isFeatureEnabled,
  normalizeFeatures,
  type FeatureKey,
  type FamilyFeatures,
} from "@/lib/features";

/**
 * useFeatures — client hook that returns the current family's feature flags.
 * The dashboard layout passes the initial set as a prop (so the server render
 * and hydration agree) and also renders it in a script tag; the API refreshes
 * it after the user toggles a flag.
 *
 * `features` are the RAW stored flags (what the Features settings toggles
 * show). To gate UI, use `useFeatureEnabled` / `isFeatureEnabled`, which also
 * apply dependencies (Rewards and Analytics need Points & streaks, #248).
 */
const Context = React.createContext<{
  features: FamilyFeatures;
  setFeature: (key: FeatureKey, enabled: boolean) => Promise<void>;
  /**
   * Change several flags in one request (PATCH `{ features }`), optimistically.
   * Used where one choice needs two flags, e.g. Rewards needs Points & streaks.
   * Only the named keys change; on failure they are put back and it throws.
   */
  updateFeatures: (changes: Partial<FamilyFeatures>) => Promise<void>;
  refresh: () => Promise<void>;
  loading: boolean;
  /** Only parents can change features; others get "ask a parent" copy. */
  canManage: boolean;
} | null>(null);

type FeatureMutation = {
  changes: Partial<FamilyFeatures>;
  requestBody:
    | { features: Partial<FamilyFeatures> }
    | { key: FeatureKey; enabled: boolean };
};

/**
 * Keep local optimistic changes visible while a serialized server mutation is
 * in flight. The server response is still the authoritative full feature map;
 * pending local changes are overlaid until their own request completes.
 */
function applyPendingMutations(
  base: FamilyFeatures,
  pending: readonly FeatureMutation[],
): FamilyFeatures {
  return pending.reduce(
    (current, mutation) => ({ ...current, ...mutation.changes }),
    base,
  );
}

/** Read the feature blob from the inline <script id="family-features"> tag. */
function readInitial(): FamilyFeatures {
  if (typeof document === "undefined") {
    // SSR without an `initial` prop — fall back to defaults.
    return defaultFeatures();
  }
  const tag = document.getElementById("family-features");
  if (!tag?.textContent) return defaultFeatures();
  try {
    // A stored blob — normalize it exactly like the server does.
    return normalizeFeatures(JSON.parse(tag.textContent));
  } catch {
    return defaultFeatures();
  }
}

export function FeaturesProvider({
  children,
  initial,
  canManage = true,
}: {
  children: React.ReactNode;
  /** Normalized flags from the server; preferred over the script tag. */
  initial?: FamilyFeatures;
  canManage?: boolean;
}) {
  const [features, setFeatures] = React.useState<FamilyFeatures>(
    () => initial ?? readInitial(),
  );
  const [loading, setLoading] = React.useState(false);
  // The server map excludes local optimistic mutations. Keeping it separate
  // means a full response from one request cannot erase a later queued change.
  const serverFeaturesRef = React.useRef(features);
  const pendingMutationsRef = React.useRef<FeatureMutation[]>([]);
  // Refreshes and mutations share one queue. A rejected request must not
  // poison later feature changes or refreshes.
  const mutationQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const pendingRefreshesRef = React.useRef(0);

  const publishVisible = React.useCallback((next: FamilyFeatures) => {
    setFeatures(next);
  }, []);

  const refresh = React.useCallback(async () => {
    pendingRefreshesRef.current += 1;
    setLoading(true);
    const run = async () => {
      const res = await fetch("/api/family/features", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const server = normalizeFeatures(data.features);
        serverFeaturesRef.current = server;
        publishVisible(
          applyPendingMutations(server, pendingMutationsRef.current),
        );
      }
    };

    const queued = mutationQueueRef.current.then(run, run);
    mutationQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued.finally(() => {
      pendingRefreshesRef.current -= 1;
      if (pendingRefreshesRef.current === 0) setLoading(false);
    });
  }, [publishVisible]);

  const enqueueMutation = React.useCallback(
    (
      changes: Partial<FamilyFeatures>,
      requestBody?:
        | { features: Partial<FamilyFeatures> }
        | { key: FeatureKey; enabled: boolean },
    ) => {
      const mutation: FeatureMutation = {
        changes: { ...changes },
        requestBody: requestBody ?? { features: { ...changes } },
      };
      pendingMutationsRef.current = [...pendingMutationsRef.current, mutation];
      publishVisible(
        applyPendingMutations(
          serverFeaturesRef.current,
          pendingMutationsRef.current,
        ),
      );

      const run = async () => {
        try {
          const res = await fetch("/api/family/features", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mutation.requestBody),
          });
          if (!res.ok) throw new Error("Failed to update features");
          const data = await res.json();
          const server = normalizeFeatures(data.features);
          serverFeaturesRef.current = server;
          pendingMutationsRef.current = pendingMutationsRef.current.filter(
            (pending) => pending !== mutation,
          );
          publishVisible(
            applyPendingMutations(server, pendingMutationsRef.current),
          );
        } catch (error) {
          pendingMutationsRef.current = pendingMutationsRef.current.filter(
            (pending) => pending !== mutation,
          );
          publishVisible(
            applyPendingMutations(
              serverFeaturesRef.current,
              pendingMutationsRef.current,
            ),
          );
          throw error;
        }
      };

      const queued = mutationQueueRef.current.then(run, run);
      mutationQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [publishVisible],
  );

  const setFeature = React.useCallback(
    (key: FeatureKey, enabled: boolean) =>
      enqueueMutation({ [key]: enabled }, { key, enabled }),
    [enqueueMutation],
  );

  const updateFeatures = React.useCallback(
    (changes: Partial<FamilyFeatures>) => enqueueMutation(changes),
    [enqueueMutation],
  );

  return (
    <Context.Provider
      value={{
        features,
        setFeature,
        updateFeatures,
        refresh,
        loading,
        canManage,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useFeatures() {
  const ctx = React.useContext(Context);
  if (!ctx) {
    // No provider? Return safe defaults. Pages should not be rendered without
    // the provider, but a missing context shouldn't crash the whole tree.
    return {
      features: defaultFeatures(),
      setFeature: async () => undefined,
      updateFeatures: async () => undefined,
      refresh: async () => undefined,
      loading: false,
      canManage: true,
    };
  }
  return ctx;
}

/** Whether a feature is effectively on (own flag AND any feature it requires). */
export function useFeatureEnabled(key: FeatureKey): boolean {
  const { features } = useFeatures();
  return isFeatureEnabled(features, key);
}
