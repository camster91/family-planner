"use client";
import { useCallback } from "react";
// Core (shell) translation only: this screen is part of the dashboard layout
// bundle, so it must not pull the full app dictionary into every page.
import { useCoreTranslation } from "@/i18n/core";

/** Copy for the in-app "page not available" screen under /dashboard. */
const en = {
  title: "This page isn't available",
  description:
    "It may be switched off for your household, or the link may be out of date.",
  home: "Go to Home",
};
const es: Record<keyof typeof en, string> = {
  title: "Esta página no está disponible",
  description:
    "Puede que esté desactivada para tu hogar o que el enlace ya no sea válido.",
  home: "Ir a Inicio",
};
export const dashboardNotFoundMessages = { en, es };
export function useDashboardNotFoundText() {
  const { t } = useCoreTranslation();
  return useCallback(
    (key: keyof typeof en) => t(key, undefined, dashboardNotFoundMessages),
    [t],
  );
}
