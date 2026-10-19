"use client";
import { useTranslation } from "@/i18n";
const en = {
  title: "Review saved changes",
  intro:
    "These changes are waiting for your review. Check the current list before retrying. Nothing here is a server confirmation.",
  open: "Review saved changes",
  refresh: "Refresh item names",
  loading: "Loading current lists…",
  close: "Close",
  empty: "No saved changes need review.",
  unsafeCreate:
    "This saved add cannot safely be retried. Check the list, then discard the saved change.",
  unavailable:
    "This item, list or person is no longer available in this household. The saved change is kept.",
  failed:
    "Could not confirm recovery. The saved changes are kept. Try loading them again.",
  retry: "Retry this change",
  discard: "Discard saved change",
  discardTitle: "Discard this saved change?",
  discardHelp:
    "This removes the waiting change from this browser. It does not undo anything already saved by the server.",
  cancel: "Keep it",
  confirmDiscard: "Discard change",
  retryRequested:
    "Retry requested. The change stays here until the server confirms it.",
  discarded: "Saved change removed from this browser.",
  busy: "Working…",
  markDone: "Mark done",
  markNotDone: "Mark not done",
  currentDone: "Currently done",
  currentNotDone: "Currently not done",
  add: "Add grocery item",
  by: "For",
  list: "List",
};
const es: Record<keyof typeof en, string> = {
  title: "Revisar cambios guardados",
  intro:
    "Estos cambios esperan tu revisión. Comprueba la lista actual antes de reintentarlos. Esta vista no confirma que el servidor los haya guardado.",
  open: "Revisar cambios guardados",
  refresh: "Actualizar nombres",
  loading: "Cargando listas actuales…",
  close: "Cerrar",
  empty: "No hay cambios guardados que revisar.",
  unsafeCreate:
    "No es seguro reintentar este añadido. Revisa la lista y después descarta el cambio guardado.",
  unavailable:
    "Este artículo, lista o persona ya no está disponible en este hogar. Se conserva el cambio guardado.",
  failed:
    "No pudimos confirmar la recuperación. Se conservan los cambios guardados. Vuelve a cargarlos.",
  retry: "Reintentar este cambio",
  discard: "Descartar cambio guardado",
  discardTitle: "¿Descartar este cambio guardado?",
  discardHelp:
    "Se elimina de este navegador el cambio en espera. No deshace nada que el servidor ya haya guardado.",
  cancel: "Conservar",
  confirmDiscard: "Descartar cambio",
  retryRequested:
    "Se solicitó el reintento. El cambio sigue aquí hasta que lo confirme el servidor.",
  discarded: "Se eliminó el cambio guardado de este navegador.",
  busy: "Procesando…",
  markDone: "Marcar como hecho",
  markNotDone: "Marcar como pendiente",
  currentDone: "Ahora está hecho",
  currentNotDone: "Ahora está pendiente",
  add: "Añadir artículo",
  by: "Para",
  list: "Lista",
};
export function useQueueReviewText() {
  const { locale } = useTranslation();
  return {
    text: (key: keyof typeof en) => (locale === "es" ? es : en)[key],
    locale,
  };
}
