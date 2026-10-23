"use client";

import { useCoreI18n } from "@/i18n/core";

/** Only the Today launcher copy belongs in the initial shell. */
const shellMessages = {
  en: { open: "Review your week", loading: "Loading your review…" },
  es: { open: "Revisa tu semana", loading: "Cargando tu revisión…" },
} as const;

export function useWeeklyResetShellText() {
  const { locale } = useCoreI18n();
  return shellMessages[locale];
}
