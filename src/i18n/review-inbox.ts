import { useTranslation } from "@/i18n";
const en = {
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
    "This inbox currently includes chore checks and changed event preparation. Extracted notices, recipe drafts and saved requests still use their existing review screens.",
};
const es: typeof en = {
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
    "Esta bandeja incluye revisiones de tareas y cambios de preparativos. Los avisos extraídos, borradores de recetas y solicitudes guardadas mantienen sus pantallas de revisión actuales.",
};
export function useReviewInboxText() {
  return useTranslation().locale === "es" ? es : en;
}
