"use client";

import * as React from "react";

const Context = React.createContext<{
  quiet: boolean;
  remembered: boolean;
  setQuiet: (quiet: boolean) => void;
}>({
  quiet: false,
  remembered: true,
  setQuiet: (_quiet: boolean) => undefined,
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
    <Context.Provider value={{ quiet, remembered, setQuiet }}>
      {children}
    </Context.Provider>
  );
}

export function useDisplayPreferences() {
  return React.useContext(Context);
}
