"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
// UI only: stored audit summaries, actor names and timestamps remain literal.
export const activityHistoryEnglish = {
  settings: "Settings",
  title: "Recent changes",
  description: "Who changed household settings, and when: features, invites, new members, the Today board and family tablets. Only parents can see this. Changes are kept for 12 months.",
  loadError: "Recent changes didn't load. Check your connection and try again.",
  offline: "You're offline. Recent changes need a connection.",
  loadingRecent: "Loading recent changes…",
  loadingOlder: "Loading older changes…",
  noChangesAnnouncement: "No changes yet.",
  shown: "{count} changes shown.",
  tryAgain: "Try again",
  emptyTitle: "No changes yet",
  emptyHint: "When a parent turns a feature on or off, sends an invite or sets up a tablet, it shows up here.",
  olderError: "Older changes didn't load. Try again.",
  loading: "Loading…",
  older: "Show older changes",
  complete: "That's everything from the last 12 months.",
  today: "Today",
  yesterday: "Yesterday",
  formerMember: "A former member",
  tabletActor: "{who}, on the family tablet",
};
export const activityHistorySpanish: Record<keyof typeof activityHistoryEnglish, string> = {
  settings: "Ajustes",
  title: "Cambios recientes",
  description: "Quién cambió los ajustes del hogar y cuándo: funciones, invitaciones, nuevos miembros, el panel de Hoy y las tabletas familiares. Solo los progenitores pueden verlo. Los cambios se conservan durante 12 meses.",
  loadError: "No se cargaron los cambios recientes. Comprueba tu conexión y vuelve a intentarlo.",
  offline: "No tienes conexión. Los cambios recientes necesitan conexión.",
  loadingRecent: "Cargando cambios recientes…",
  loadingOlder: "Cargando cambios anteriores…",
  noChangesAnnouncement: "Aún no hay cambios.",
  shown: "Se muestran {count} cambios.",
  tryAgain: "Reintentar",
  emptyTitle: "Aún no hay cambios",
  emptyHint: "Cuando un progenitor activa o desactiva una función, envía una invitación o configura una tableta, aparece aquí.",
  olderError: "No se cargaron los cambios anteriores. Vuelve a intentarlo.",
  loading: "Cargando…",
  older: "Mostrar cambios anteriores",
  complete: "Eso es todo lo de los últimos 12 meses.",
  today: "Hoy",
  yesterday: "Ayer",
  formerMember: "Un antiguo miembro",
  tabletActor: "{who}, en la tableta familiar",
};
const messages = { en: activityHistoryEnglish, es: activityHistorySpanish };
export function useActivityHistoryText() {
  const { t } = useTranslation();
  return useCallback(
    (key: keyof typeof activityHistoryEnglish, params?: Record<string, string | number>) => t(key, params, messages),
    [t],
  );
}
