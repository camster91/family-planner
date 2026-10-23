"use client";

import * as React from "react";
import { canonicalBodySignature } from "@/lib/request-signature";
import {
  defaultPersonalLayout,
  normalizePersonalLayout,
  type PersonalLayout,
  type TodayLayout,
} from "@/lib/personal-layout";
import {
  displaySnapshotSchema,
  type DisplaySnapshot,
} from "@/lib/display-preferences-snapshot-schema";

type SyncState = "loading" | "ready" | "error" | "unsupported" | "forbidden";
type SyncError = "offline" | "conflict" | "failed" | null;
type PreferencePatch = {
  today?: TodayLayout;
  favorites?: string[];
  quiet?: boolean;
  inheritToday?: true;
};
type Result = Promise<DisplaySnapshot | null>;
const Context = React.createContext<{
  quiet: boolean;
  remembered: boolean;
  saving: boolean;
  syncState: SyncState;
  syncError: SyncError;
  layout: PersonalLayout;
  today: TodayLayout;
  defaultToday: TodayLayout;
  personalizedToday: boolean;
  revision: number;
  defaultsRevision: number;
  canManageDefaults: boolean;
  setQuiet: (quiet: boolean) => Result;
  previewToday: (layout: TodayLayout | null) => void;
  saveToday: (layout: TodayLayout, expectedRevision?: number) => Result;
  resetToday: (expectedRevision?: number) => Result;
  saveDefaults: (layout: TodayLayout, expectedRevision?: number) => Result;
  toggleFavorite: (key: string, permittedKeys?: readonly string[]) => Result;
  refresh: () => Promise<void>;
}>({
  quiet: false,
  remembered: true,
  saving: false,
  syncState: "unsupported",
  syncError: null,
  layout: defaultPersonalLayout(),
  today: defaultPersonalLayout().today,
  defaultToday: defaultPersonalLayout().today,
  personalizedToday: false,
  revision: 0,
  defaultsRevision: 0,
  canManageDefaults: false,
  setQuiet: async () => null,
  previewToday: () => undefined,
  saveToday: async () => null,
  resetToday: async () => null,
  saveDefaults: async () => null,
  toggleFavorite: async () => null,
  refresh: async () => undefined,
});

/** Canonical account preferences; owner-scoped storage is a read cache, never authority. */
export function DisplayPreferencesProvider({
  viewerId,
  children,
}: {
  viewerId: string;
  children: React.ReactNode;
}) {
  const cacheKey = `herewoven:display-account:${viewerId}:v1`;
  const [snapshot, setSnapshot] = React.useState<DisplaySnapshot | null>(null);
  const current = React.useRef<DisplaySnapshot | null>(null);
  const [syncState, setSyncState] = React.useState<SyncState>("loading");
  const stateRef = React.useRef<SyncState>("loading");
  const [syncError, setSyncError] = React.useState<SyncError>(null);
  const [remembered, setRemembered] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState<TodayLayout | null>(null);
  const busy = React.useRef(false),
    loadSequence = React.useRef(0),
    mounted = React.useRef(true);
  const state = (next: SyncState) => {
    stateRef.current = next;
    setSyncState(next);
  };
  const publish = React.useCallback(
    (next: DisplaySnapshot) => {
      current.current = next;
      setSnapshot(next);
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(next));
        setRemembered(true);
      } catch {
        setRemembered(false);
      }
    },
    [cacheKey],
  );
  const refresh = React.useCallback(async () => {
    if (busy.current) return;
    const sequence = ++loadSequence.current;
    state("loading");
    setSyncError(null);
    try {
      const response = await fetch("/api/users/display-preferences", {
        cache: "no-store",
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!mounted.current || sequence !== loadSequence.current) return;
      const parsed = displaySnapshotSchema.safeParse(raw);
      if (response.ok && parsed.success) {
        publish(parsed.data);
        state("ready");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        current.current = null;
        setSnapshot(null);
        setPreview(null);
        state("forbidden");
        return;
      }
      const code =
        raw && typeof raw === "object"
          ? (raw as { error?: { code?: string } }).error?.code
          : undefined;
      state(
        response.status === 404 || code === "DISPLAY_PREFERENCES_UNSUPPORTED"
          ? "unsupported"
          : "error",
      );
      setSyncError("failed");
    } catch {
      if (mounted.current && sequence === loadSequence.current) {
        state("error");
        setSyncError("offline");
      }
    }
  }, [publish]);
  React.useEffect(() => {
    mounted.current = true;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      const parsed = displaySnapshotSchema.safeParse(
        cached ? JSON.parse(cached) : null,
      );
      if (parsed.success) {
        current.current = parsed.data;
        setSnapshot(parsed.data);
      }
    } catch {
      setRemembered(false);
    }
    void refresh();
    const focused = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focused);
    return () => {
      mounted.current = false;
      loadSequence.current += 1;
      window.removeEventListener("focus", focused);
    };
  }, [cacheKey, refresh]);
  const mutate = React.useCallback(
    async (
      patch: PreferencePatch,
      household = false,
      expected?: number,
    ): Result => {
      const prior = current.current;
      if (busy.current || stateRef.current !== "ready" || !prior) return null;
      if (household && !prior.canManageDefaults) return null;
      const revision = household ? prior.defaultsRevision : prior.revision;
      if (expected !== undefined && expected !== revision) {
        setSyncError("conflict");
        return null;
      }
      busy.current = true;
      loadSequence.current += 1;
      setSaving(true);
      setSyncError(null);
      try {
        const response = await fetch(
          household
            ? "/api/family/display-defaults"
            : "/api/users/display-preferences",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...patch,
              expectedRevision: expected ?? revision,
            }),
          },
        );
        const raw: unknown = await response.json().catch(() => null);
        if (!mounted.current) return null;
        const parsed = displaySnapshotSchema.safeParse(raw);
        if (!response.ok || !parsed.success) {
          setSyncError(response.status === 409 ? "conflict" : "failed");
          if (response.status === 401 || response.status === 403)
            state("forbidden");
          return null;
        }
        // Do not turn a malformed/later receipt into a successful local save.
        const received = household
          ? parsed.data.defaultsRevision
          : parsed.data.revision;
        const requestedToday = household
          ? parsed.data.defaultToday
          : parsed.data.layout.today;
        if (
          received !== revision + 1 ||
          (patch.today &&
            canonicalBodySignature(requestedToday) !==
              canonicalBodySignature(patch.today)) ||
          (patch.quiet !== undefined && parsed.data.quiet !== patch.quiet) ||
          (patch.inheritToday && parsed.data.personalizedToday)
        ) {
          setSyncError("failed");
          return null;
        }
        publish(parsed.data);
        setPreview(null);
        state("ready");
        return parsed.data;
      } catch {
        if (mounted.current) setSyncError("offline");
        return null;
      } finally {
        busy.current = false;
        if (mounted.current) setSaving(false);
      }
    },
    [publish],
  );
  const saveToday = React.useCallback(
    (today: TodayLayout, expected?: number) =>
      mutate({ today }, false, expected),
    [mutate],
  );
  const resetToday = React.useCallback(
    (expected?: number) => mutate({ inheritToday: true }, false, expected),
    [mutate],
  );
  const saveDefaults = React.useCallback(
    (today: TodayLayout, expected?: number) =>
      mutate({ today }, true, expected),
    [mutate],
  );
  const setQuiet = React.useCallback(
    (quiet: boolean) => mutate({ quiet }),
    [mutate],
  );
  const toggleFavorite = React.useCallback(
    (key: string, permittedKeys?: readonly string[]) => {
      const prior = current.current;
      if (!prior) return Promise.resolve(null);
      const permitted = permittedKeys
        ? prior.layout.favorites.filter((item) => permittedKeys.includes(item))
        : prior.layout.favorites;
      const favorites = permitted.includes(key)
        ? permitted.filter((item) => item !== key)
        : [...permitted, key];
      return mutate({ favorites });
    },
    [mutate],
  );
  const layout = snapshot?.layout ?? defaultPersonalLayout();
  return (
    <Context.Provider
      value={{
        quiet: snapshot?.quiet ?? false,
        remembered,
        saving,
        syncState,
        syncError,
        layout: normalizePersonalLayout(layout),
        today: preview ?? layout.today,
        defaultToday: snapshot?.defaultToday ?? defaultPersonalLayout().today,
        personalizedToday: snapshot?.personalizedToday ?? false,
        revision: snapshot?.revision ?? 0,
        defaultsRevision: snapshot?.defaultsRevision ?? 0,
        canManageDefaults: snapshot?.canManageDefaults ?? false,
        previewToday: setPreview,
        saveToday,
        resetToday,
        saveDefaults,
        setQuiet,
        toggleFavorite,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDisplayPreferences() {
  return React.useContext(Context);
}
