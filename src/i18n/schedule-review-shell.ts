import { useTranslation } from "@/i18n";

/** Launcher and loading copy only; full editor dictionaries stay with their sheets. */
export const scheduleReviewShellMessages = {
  en: {
    open: "Review timing",
    close: "Close timing review",
    loading: "Loading the current schedule…",
    error:
      "Could not confirm the latest schedule. Your settings and saved requests are kept.",
  },
  es: {
    open: "Revisar horario",
    close: "Cerrar revisión de horario",
    loading: "Cargando la agenda actual…",
    error:
      "No se pudo confirmar la agenda actual. Tus ajustes y solicitudes guardadas se conservan.",
  },
};
export function useScheduleReviewShellText() {
  return scheduleReviewShellMessages[useTranslation().locale];
}
