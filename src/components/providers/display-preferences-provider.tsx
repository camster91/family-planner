"use client";

import * as React from "react";
import {
  defaultPersonalLayout,
  normalizePersonalLayout,
  type PersonalLayout,
  type TodayLayout,
} from "@/lib/personal-layout";

const Context = React.createContext<{
  quiet: boolean;
  remembered: boolean;
  setQuiet: (quiet: boolean) => void;
  layout: PersonalLayout;
  today: TodayLayout;
  previewToday: (layout: TodayLayout | null) => void;
  saveToday: (layout: TodayLayout) => void;
  toggleFavorite: (key: string, permittedKeys?: readonly string[]) => void;
}>({
  quiet: false,
  remembered: true,
  setQuiet: (_quiet: boolean) => undefined,
  layout: defaultPersonalLayout(),
  today: defaultPersonalLayout().today,
  previewToday: () => undefined,
  saveToday: () => undefined,
  toggleFavorite: () => undefined,
});

/** Presentation only. Never changes household flags, earned points or access. */
export function DisplayPreferencesProvider({
  viewerId,
  children,
}: {
  viewerId: string;
  children: React.ReactNode;
}) {
  const storageKey = `herewoven:display:${viewerId}:v1`;
  const layoutKey = `herewoven:layout:${viewerId}:v1`;
  const [layout, setLayout] = React.useState(defaultPersonalLayout);
  const layoutRef = React.useRef(layout);
  const [preview, setPreview] = React.useState<TodayLayout | null>(null);
  const [layoutRemembered, setLayoutRemembered] = React.useState(true);
  React.useEffect(() => {
    const read = () => {
      try {
        const saved = window.localStorage.getItem(layoutKey);
        const next = normalizePersonalLayout(saved ? JSON.parse(saved) : null);
        layoutRef.current = next;
        setLayout(next);
        setLayoutRemembered(true);
      } catch {
        setLayoutRemembered(false);
      }
    };
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === layoutKey || event.key === null) read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [layoutKey]);
  const publish = React.useCallback(
    (next: PersonalLayout) => {
      const normalized = normalizePersonalLayout(next);
      layoutRef.current = normalized;
      setLayout(normalized);
      try {
        window.localStorage.setItem(layoutKey, JSON.stringify(normalized));
        setLayoutRemembered(true);
      } catch {
        setLayoutRemembered(false);
      }
    },
    [layoutKey],
  );
  const saveToday = React.useCallback(
    (today: TodayLayout) => {
      publish({ ...layoutRef.current, today });
      setPreview(null);
    },
    [publish],
  );
  const toggleFavorite = React.useCallback(
    (key: string, permittedKeys?: readonly string[]) => {
      const current = layoutRef.current;
      const permitted = permittedKeys
        ? current.favorites.filter((item) => permittedKeys.includes(item))
        : current.favorites;
      const favorites = permitted.includes(key)
        ? permitted.filter((item) => item !== key)
        : [...permitted, key];
      publish({ ...current, favorites });
    },
    [publish],
  );
  const [quiet, updateQuiet] = React.useState(false);
  const [remembered, setRemembered] = React.useState(true);
  React.useEffect(() => {
    const read = () => {
      try {
        updateQuiet(window.localStorage.getItem(storageKey) === "quiet");
        setRemembered(true);
      } catch {
        setRemembered(false);
      }
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);
  const setQuiet = React.useCallback(
    (next: boolean) => {
      updateQuiet(next);
      try {
        window.localStorage.setItem(storageKey, next ? "quiet" : "standard");
        setRemembered(true);
      } catch {
        setRemembered(false);
      }
    },
    [storageKey],
  );
  return (
    <Context.Provider
      value={{
        quiet,
        remembered: remembered && layoutRemembered,
        setQuiet,
        layout,
        today: preview ?? layout.today,
        previewToday: setPreview,
        saveToday,
        toggleFavorite,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDisplayPreferences() {
  return React.useContext(Context);
}
