import { reviewInboxShellMessages } from "./review-inbox-shell";
import { useTranslation } from "@/i18n";
const en = {
  ...reviewInboxShellMessages.en,
  food: "Meal planning drafts & saves",
  bulk: "Bulk cooking drafts & saves",
  savedFood: "Saved meal planning work",
  savedBulk: "Saved bulk cooking work",
  savedTimeUnknown: "Time not recorded for this saved work.",
  recipe: "Recipe drafts & saves",
  savedRecipe: "Saved recipe work",
  savedCapture: "Saved quick-add work",
  draftUnsubmitted:
    "Not submitted yet. Open the original editor to finish or discard this draft.",
  leaveCapture:
    "Opening Recipes will leave this unfinished preview. Saved requests stay available. Leave this preview?",
  capture: "Quick add reviews",
  captureHint:
    "Review notices and quick-add suggestions here, or check earlier saved requests. Adding anything still needs your confirmation.",
  recipeDrafts: "Review recipe imports",
  recipeHint:
    "Recipe imports open in Meals, where you can edit the extracted recipe, check unknown details and review duplicates before saving.",
  loadingReview: "Opening review…",
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
  responsibility: "Responsibility & backup",
  savedResponsibility: "Saved responsibility request",
  savedUnknown: "Result not checked here. This may already have been saved.",
  openSaved: "Open recovery screen",
  intro:
    "Check current work and timing changes. Each item opens its normal review; nothing is approved here automatically.",
  changes: "What changed",
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
    "This inbox currently includes chore checks and changed event preparation. Quick add uses its existing review and recovery controls here; recipe imports open in Meals.",
};
const es: typeof en = {
  ...reviewInboxShellMessages.es,
  food: "Borradores y guardados de planificación de comidas",
  bulk: "Borradores y guardados de cocina por lotes",
  savedFood: "Planificación de comidas guardada",
  savedBulk: "Cocina por lotes guardada",
  savedTimeUnknown: "No se registró la hora de este trabajo.",
  recipe: "Borradores y guardados de recetas",
  savedRecipe: "Trabajo de recetas guardado",
  savedCapture: "Captura rápida guardada",
  draftUnsubmitted:
    "Aún no se ha enviado. Abre el editor original para terminar o descartar el borrador.",
  leaveCapture:
    "Abrir Recetas dejará este borrador sin terminar. Las solicitudes guardadas se conservan. ¿Salir del borrador?",
  capture: "Revisar captura rápida",
  captureHint:
    "Revisa avisos y sugerencias o consulta solicitudes guardadas. Para añadir algo debes confirmarlo.",
  recipeDrafts: "Revisar recetas importadas",
  recipeHint:
    "Las importaciones se abren en Comidas para editar la receta, revisar datos desconocidos y duplicados antes de guardar.",
  loadingReview: "Abriendo revisión…",
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
  responsibility: "Responsables y suplentes",
  savedResponsibility: "Solicitud de responsabilidad guardada",
  savedUnknown: "Resultado sin consultar aquí. Puede que ya esté guardado.",
  openSaved: "Abrir recuperación",
  intro:
    "Revisa tareas y cambios de horario. Cada elemento abre su revisión habitual; aquí no se aprueba nada automáticamente.",
  changes: "Qué cambió",
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
    "Esta bandeja incluye revisiones de tareas y cambios de preparativos. La captura rápida usa aquí sus controles habituales de revisión y recuperación; las recetas importadas se abren en Comidas.",
};
export function useReviewInboxText() {
  return useTranslation().locale === "es" ? es : en;
}
