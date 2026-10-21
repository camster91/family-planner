import { useTranslation } from "@/i18n";
const en = {
  saved: "Saved requests",
  schedule: "Schedule changes",
  savedType: "Type of saved request",
  checkSaved: "Check this device",
  checking: "Checking…",
  savedHint:
    "Check requests saved on this device. Open the original screen to confirm what happened; this does not send anything.",
  savedUnavailable:
    "Could not finish checking saved requests. They have been kept. Close other review screens and try again, or open the original feature.",
  savedPaused:
    "New changes are paused. Previous requests can still be checked in their original screen.",
  savedEmpty:
    "No saved requests of this type were found in the checked stores on this device.",
  savedPreparation: "Saved preparation request",
  savedSchedule: "Saved schedule request",
  savedUnknown: "Result not checked here. This may already have been saved.",
  openSaved: "Open recovery screen",
  title: "Review inbox",
  intro:
    "Check current work and timing changes. Each item opens its normal review; nothing is approved here automatically.",
  checks: "Parent checks",
  preparation: "Preparation timing",
  openChecks: "Open chore checks",
  changed: "Event changed since preparation was reviewed",
  waiting: "Marked done · waiting for a parent",
  empty: "No review items in this page.",
  next: "Next page",
  first: "Start over",
  more: "There may be more to review. Check the next page.",
  paused: "Preparation review is not available yet.",
  scope:
    "This inbox currently includes chore checks and changed event preparation. Extracted notices and recipe drafts still use their existing review screens.",
};
const es: typeof en = {
  saved: "Solicitudes guardadas",
  schedule: "Cambios de horario",
  savedType: "Tipo de solicitud guardada",
  checkSaved: "Consultar este dispositivo",
  checking: "Consultando…",
  savedHint:
    "Consulta solicitudes guardadas en este dispositivo. Abre su pantalla original para confirmar el resultado; esto no envía nada.",
  savedUnavailable:
    "No se pudo completar la consulta. Las solicitudes se conservan. Cierra otras revisiones e inténtalo de nuevo o abre la función original.",
  savedPaused:
    "Los cambios nuevos están pausados. Puedes consultar solicitudes anteriores en su pantalla original.",
  savedEmpty:
    "No se encontraron solicitudes de este tipo en los almacenes consultados de este dispositivo.",
  savedPreparation: "Solicitud de preparativos guardada",
  savedSchedule: "Solicitud de horario guardada",
  savedUnknown: "Resultado sin consultar aquí. Puede que ya esté guardado.",
  openSaved: "Abrir recuperación",
  title: "Bandeja de revisión",
  intro:
    "Revisa tareas y cambios de horario. Cada elemento abre su revisión habitual; aquí no se aprueba nada automáticamente.",
  checks: "Revisión de tareas",
  preparation: "Horario de preparativos",
  openChecks: "Abrir revisión de tareas",
  changed: "El evento cambió desde la última revisión",
  waiting: "Marcada como hecha · pendiente de revisión",
  empty: "No hay elementos para revisar en esta página.",
  next: "Página siguiente",
  first: "Volver al inicio",
  more: "Quedan registros por consultar. Continúa a la página siguiente.",
  paused: "La revisión de preparativos aún no está disponible.",
  scope:
    "Esta bandeja incluye revisiones de tareas y cambios de preparativos. Los avisos extraídos y borradores de recetas mantienen sus pantallas de revisión actuales.",
};
export function useReviewInboxText() {
  return useTranslation().locale === "es" ? es : en;
}
