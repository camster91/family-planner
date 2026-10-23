import { useCoreI18n } from "@/i18n/core";

/** Launcher and loading copy only; full editor dictionaries stay with their sheets. */
export const preparationShellMessages = {
  en: {
    forEvent: "Getting ready for:",
    open: "Prepare for this event",
    backlink: "View event preparation",
    close: "Close preparation",
    loading: "Loading current preparation…",
    error:
      "Could not confirm the latest changes. Your draft and saved requests are kept.",
  },
  es: {
    forEvent: "Preparativos para:",
    open: "Preparar este evento",
    backlink: "Ver preparativos del evento",
    close: "Cerrar preparativos",
    loading: "Cargando preparativos actuales…",
    error:
      "No se pudieron confirmar los cambios. Se conservan el borrador y las solicitudes guardadas.",
  },
};
export function usePreparationShellText() {
  return preparationShellMessages[useCoreI18n().locale];
}
