import { useTranslation } from "@/i18n";

/** Launcher and loading copy only; full editor dictionaries stay with their sheets. */
export const responsibilityShellMessages = {
  en: {
    open: "Responsibility",
    loading: "Loading the current plan…",
  },
  es: {
    open: "Responsabilidad",
    loading: "Cargando el plan actual…",
  },
};
export function useResponsibilityShellText() {
  return responsibilityShellMessages[useTranslation().locale];
}
