"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Locale } from "./types";
import { CLOCK_FORMAT_STORAGE_KEY, isClockFormat, readClockFormat, writeClockFormat, type ClockFormat } from "@/lib/clock-format";
import { pseudolocalizeTemplate } from "./pseudo";

export type { Locale } from "./types";

/**
 * The small set of generic strings used by the initial app shell. Feature
 * dictionaries stay in the route that owns them; keeping this catalog small
 * prevents the shell from pulling the legacy dictionary into every route.
 */
const coreMessages = {
  en: {
    common: { loading: "Loading..." },
    routeState: {
      loading: "Loading…",
      errorTitle: "This page did not load",
      errorBody:
        "Something went wrong while loading it. Try again, or come back in a minute.",
      tryAgain: "Try again",
      backToToday: "Back to Today",
    },
    groceries: {
      storageOwnerChanged:
        "Saved changes belong to an earlier account, household or tablet session. They are kept here and will not be sent.",
      storageVersionRequired:
        "Saved changes need a compatible recovery version. They are kept here. Do not add them again.",
      compatibleClient:
        "Pending changes need a compatible app version. Refresh or update this app. They are kept on this device and won’t be sent. Don’t add them again.",
      storageUnavailable:
        "We couldn’t load saved changes. New changes are paused to protect them.",
      storageRetry: "Try loading saved changes",
      storageRetrying: "Loading saved changes…",
    },
  },
  es: {
    common: { loading: "Cargando..." },
    routeState: {
      loading: "Cargando…",
      errorTitle: "Esta pagina no se cargo",
      errorBody:
        "Algo salio mal al cargarla. Intentalo de nuevo o vuelve en un minuto.",
      tryAgain: "Intentar de nuevo",
      backToToday: "Volver a Hoy",
    },
    groceries: {
      storageOwnerChanged:
        "Los cambios guardados pertenecen a una sesión anterior de la cuenta, el hogar o la tableta. Se conservan aquí y no se enviarán.",
      storageVersionRequired:
        "Los cambios guardados necesitan una versión de recuperación compatible. Se conservan aquí. No los añadas de nuevo.",
      compatibleClient:
        "Los cambios pendientes necesitan una versión compatible. Actualiza esta app. Se conservan en este dispositivo y no se enviarán. No los añadas de nuevo.",
      storageUnavailable:
        "No pudimos cargar los cambios guardados. Pausamos los cambios nuevos para protegerlos.",
      storageRetry: "Intentar cargar los cambios guardados",
      storageRetrying: "Cargando los cambios guardados…",
    },
  },
} as const;

/** Route-owned dictionaries are passed by their consumers, never imported here. */
export type ScopedMessages = Record<Locale, Record<string, unknown>>;

export function translateMessage(
  source: unknown,
  key: string,
  params?: Record<string, string | number>,
  pseudolocalize = false,
): string {
  let value = source;
  for (const part of key.split(".")) {
    if (value && typeof value === "object" && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof value !== "string") return key;
  const template = pseudolocalize ? pseudolocalizeTemplate(value) : value;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, part) =>
    String(params[part] ?? `{${part}}`),
  );
}

type CoreI18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  clockFormat: ClockFormat;
  clockRemembered: boolean;
  setClockFormat: (format: ClockFormat) => void;
  /** Whether a provider was mounted. This preserves provider-free fallbacks. */
  provided: boolean;
  pseudolocalize: boolean;
};

const defaultContext: CoreI18nContextValue = {
  locale: "en",
  setLocale: () => {},
  clockFormat: "auto",
  clockRemembered: true,
  setClockFormat: () => {},
  provided: false,
  pseudolocalize: false,
};

const CoreI18nContext = createContext<CoreI18nContextValue>(defaultContext);

// The language picked in Settings. Per device (browser storage), not per account.
export const LOCALE_STORAGE_KEY = "familyPlanner_language";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "es"];

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage blocked (private mode, policy): stay on the default.
    return null;
  }
}

function writeStoredLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
}

/**
 * Shared shell provider. The server always renders the requested locale and
 * the saved device locale applies after mount, preserving the existing
 * hydration contract.
 */
export function CoreI18nProvider({
  children,
  locale = "en",
  persistLocale = false,
  pseudolocalize = false,
}: {
  children: ReactNode;
  locale?: Locale;
  persistLocale?: boolean;
  /** Local/CI QA only; never adds a public language or changes stored values. */
  pseudolocalize?: boolean;
}) {
  const [currentLocale, setCurrentLocale] = useState<Locale>(locale);
  // Default is identical during SSR/hydration; device storage applies after mount.
  const [clockFormat, setCurrentClockFormat] = useState<ClockFormat>("auto");
  const [clockRemembered, setClockRemembered] = useState(true);
  useEffect(() => {
    if (!persistLocale) return;
    setCurrentClockFormat(readClockFormat());
    const changed = (event: StorageEvent) => {
      if (event.key === CLOCK_FORMAT_STORAGE_KEY || event.key === null) {
        setCurrentClockFormat(readClockFormat());
        setClockRemembered(true);
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [persistLocale]);
  const setClockFormat = useCallback((next: ClockFormat) => {
    if (!isClockFormat(next)) return;
    setCurrentClockFormat(next);
    setClockRemembered(persistLocale ? writeClockFormat(next) : false);
  }, [persistLocale]);

  useEffect(() => {
    if (!persistLocale) return;
    const stored = readStoredLocale();
    if (stored) setCurrentLocale(stored);
  }, [persistLocale]);

  useEffect(() => {
    if (!persistLocale) return;
    document.documentElement.lang = currentLocale;
  }, [persistLocale, currentLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setCurrentLocale(next);
      if (persistLocale) writeStoredLocale(next);
    },
    [persistLocale],
  );

  return (
    <CoreI18nContext.Provider
      value={{
        locale: currentLocale,
        setLocale,
        clockFormat,
        clockRemembered,
        setClockFormat,
        provided: true,
        pseudolocalize,
      }}
    >
      {children}
    </CoreI18nContext.Provider>
  );
}

export function useCoreI18n() {
  return useContext(CoreI18nContext);
}

/**
 * Translation hook for shared-shell and route-scoped dictionaries. Outside a
 * provider it retains the old behavior: scoped English fallback and raw keys
 * for unscoped strings.
 */
export function useCoreTranslation() {
  const context = useCoreI18n();
  const t = useCallback(
    (
      key: string,
      params?: Record<string, string | number>,
      scoped?: ScopedMessages,
    ) => {
      if (!context.provided) {
        return scoped ? translateMessage(scoped.en, key, params) : key;
      }
      const source = scoped ?? coreMessages;
      return translateMessage(
        source[context.locale],
        key,
        params,
        context.pseudolocalize,
      );
    },
    [context.locale, context.provided, context.pseudolocalize],
  );
  return { locale: context.locale, t, setLocale: context.setLocale };
}
