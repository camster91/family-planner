"use client";
import { useTranslation } from "@/i18n";
const en = {
  open: "Review older saved changes",
  title: "Older changes need your review",
  intro:
    "Nothing will be sent automatically. Keep verified changes for review, or explicitly discard an older copy. Anything left here keeps the old storage unchanged.",
  loading: "Checking current lists and ownership…",
  refresh: "Reload older changes",
  empty: "No supported older changes were found.",
  keep: "Keep for review",
  discard: "Discard older copy",
  leave: "Leave here",
  choice: "What should happen to this change?",
  missing:
    "This target or person is unavailable in the current household. Its saved content is hidden.",
  tick: "Mark done",
  untick: "Mark not done",
  add: "Saved grocery add",
  original:
    "The original tablet for this add cannot be confirmed. Keeping it saves a locked copy; it cannot be retried under a new pairing.",
  move: "Move changes into review",
  confirm: "Confirm older changes",
  confirmHelp:
    "Kept changes move into this session's review list with the same request keys. Discarded older copies are removed. This does not undo server changes or discard an existing verified copy.",
  cancel: "Keep everything here",
  close: "Close",
  busy: "Moving…",
  failed:
    "The move could not be confirmed. Your saved work is kept. If copying began, retry the same choice and keep this browser open.",
  capacity:
    "There are too many changes to combine safely. Keep fewer older copies or leave everything here; nothing was evicted.",
  kept: "Keep",
  discarded: "Discard",
  unresolved: "Left here",
  moved: "Older changes moved into review. They have not been sent.",
  previous: "Previous",
  next: "Next",
  page: "Page",
  of: "of",
  locked:
    "Choices are locked while an unconfirmed move is recovered. Retry the same move.",
};
const es: Record<keyof typeof en, string> = {
  open: "Revisar cambios antiguos",
  title: "Los cambios antiguos necesitan revisión",
  intro:
    "No se enviará nada automáticamente. Conserva los cambios verificados para revisarlos o descarta explícitamente una copia antigua. Lo que dejes aquí mantiene intacto el almacenamiento anterior.",
  loading: "Comprobando listas actuales y titularidad…",
  refresh: "Volver a cargar cambios antiguos",
  empty: "No se encontraron cambios antiguos compatibles.",
  keep: "Conservar para revisión",
  discard: "Descartar copia antigua",
  leave: "Dejar aquí",
  choice: "¿Qué debe pasar con este cambio?",
  missing:
    "Este destino o persona no está disponible en el hogar actual. Se oculta su contenido guardado.",
  tick: "Marcar como hecho",
  untick: "Marcar como pendiente",
  add: "Añadido de compra guardado",
  original:
    "No se puede confirmar la tableta original de este añadido. Al conservarlo se guarda una copia bloqueada; no se puede reintentar con otra vinculación.",
  move: "Pasar cambios a revisión",
  confirm: "Confirmar cambios antiguos",
  confirmHelp:
    "Los cambios conservados pasan a la revisión de esta sesión con las mismas claves de solicitud. Se eliminan las copias antiguas descartadas. No deshace cambios del servidor ni descarta una copia verificada existente.",
  cancel: "Conservar todo aquí",
  close: "Cerrar",
  busy: "Trasladando…",
  failed:
    "No se pudo confirmar el traslado. Se conserva tu trabajo. Si empezó la copia, reintenta la misma elección y mantén abierto este navegador.",
  capacity:
    "Hay demasiados cambios para combinarlos de forma segura. Conserva menos copias antiguas o deja todo aquí; no se eliminó ningún cambio para hacer espacio.",
  kept: "Conservar",
  discarded: "Descartar",
  unresolved: "Dejar aquí",
  moved: "Los cambios antiguos pasaron a revisión. No se han enviado.",
  previous: "Anterior",
  next: "Siguiente",
  page: "Página",
  of: "de",
  locked:
    "Las elecciones están bloqueadas mientras se recupera un traslado sin confirmar. Reintenta el mismo traslado.",
};
export function useLegacyQueueText() {
  const { locale } = useTranslation();
  return {
    text: (key: keyof typeof en) => (locale === "es" ? es : en)[key],
    locale,
  };
}
