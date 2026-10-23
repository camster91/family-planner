"use client";

import { useCoreI18n } from "@/i18n/core";

/** The Today launcher copy stays in the shell; the editor dictionary is lazy. */
const shellMessages = {
  en: { customize: "Customize Today" },
  es: { customize: "Personalizar Hoy" },
} as const;

export function usePersonalLayoutShellText() {
  const { locale } = useCoreI18n();
  return (key: "customize") => shellMessages[locale][key];
}
