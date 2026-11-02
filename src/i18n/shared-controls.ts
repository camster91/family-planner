"use client";
import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
const en = {
  search: "Search",
  clear: "Clear",
  errorTitle: "Something went wrong",
  errorMessage: "An unexpected error occurred.",
  tryAgain: "Try Again",
};
const es: Record<keyof typeof en, string> = {
  search: "Buscar",
  clear: "Borrar",
  errorTitle: "Algo salió mal",
  errorMessage: "Se produjo un error inesperado.",
  tryAgain: "Reintentar",
};
const messages = { en, es };
export function useSharedControlsText() {
  const { t } = useCoreTranslation();
  return useCallback((key: keyof typeof en) => t(key, undefined, messages), [t]);
}
