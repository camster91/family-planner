"use client";
import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
const en = {
  signedOutTitle: "Not Authenticated", signedOutBody: "Please sign in to access the dashboard.",
  skipMain: "Skip to main content", mainLabel: "{brand} dashboard",
  todayTitle: "Today", todayHousehold: "Join or create a household to see today's plans here.",
  createHousehold: "Create a household", joinCode: "Join with a code",
  budgetTitle: "No Family Yet", budgetHousehold: "Join or create a family to start tracking your budget.",
  activityTitle: "Recent changes", activityHousehold: "Join or create a household to see its recent changes.",
  sheetClose: "Close and return", sheetBusy: "Please wait for saving or uploading to finish.",
  sheetDraft: "Close to return. Unsaved changes will be cleared.",
};
const es: Record<keyof typeof en, string> = {
  signedOutTitle: "Sin sesión iniciada", signedOutBody: "Inicia sesión para acceder al panel.",
  skipMain: "Saltar al contenido principal", mainLabel: "Panel de {brand}",
  todayTitle: "Hoy", todayHousehold: "Únete a un hogar o crea uno para ver aquí los planes de hoy.",
  createHousehold: "Crear un hogar", joinCode: "Unirse con un código",
  budgetTitle: "Aún no hay una familia", budgetHousehold: "Únete a una familia o crea una para empezar a llevar el presupuesto.",
  activityTitle: "Cambios recientes", activityHousehold: "Únete a un hogar o crea uno para ver sus cambios recientes.",
  sheetClose: "Cerrar y volver", sheetBusy: "Espera a que termine el guardado o la carga.",
  sheetDraft: "Cierra para volver. Los cambios sin guardar se borrarán.",
};
const messages = { en, es };
export function useDashboardFrameText() {
  const { t } = useCoreTranslation();
  return useCallback((key: keyof typeof en, params?: Record<string, string | number>) => t(key, params, messages), [t]);
}
