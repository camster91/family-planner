import { useTranslation } from "@/i18n";
import type { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";

/** Fixed local copy only: never include saved fields, keys or storage contents. */
const en: Record<OwnedRequestRecoveryError["reason"], string> = {
  UNAVAILABLE:
    "Saved work could not be verified. Keep this screen open and use Recover saved work before continuing. Do not clear this app’s storage.",
  OWNER_CHANGED:
    "Your account or household changed. Reload before opening saved work.",
  DISABLED:
    "New changes are paused. Your saved work is kept; try again when draft saving is available.",
  UPDATE_REQUIRED:
    "This version cannot read the saved work’s format. Keep this screen open and do not clear app storage. Use a supported app version before continuing recovery.",
  DIVERGENT:
    "Saved copies disagree, or another tab changed this review. Recovery stopped without choosing a copy for you. Keep any unsaved fields here and do not clear app storage or repeat unconfirmed requests. Finish recovery in the tab that last saved successfully.",
  REVIEW_REQUIRED:
    "This review has passed its retry window. It is kept for review; discard only an unsubmitted draft to start again.",
  CAPACITY:
    "This review exceeds the device save limit. Keep this screen open, reduce unsubmitted items or text, then try saving again. Unsaved changes still need saving.",
  INTENT_CHANGED:
    "The saved review no longer matches this action. Keep this screen open and recover saved work before continuing. Do not repeat an unconfirmed request as a new item.",
};
const es: typeof en = {
  UNAVAILABLE:
    "No se pudo verificar el trabajo guardado. Mantén esta pantalla abierta y usa Recuperar trabajo guardado antes de continuar. No borres los datos de la aplicación.",
  OWNER_CHANGED:
    "Tu cuenta o tu hogar cambió. Recarga antes de abrir el trabajo guardado.",
  DISABLED:
    "Los cambios nuevos están pausados. Se conserva el trabajo guardado; vuelve a intentarlo cuando se puedan guardar borradores.",
  UPDATE_REQUIRED:
    "Esta versión no puede leer el formato del trabajo guardado. Mantén esta pantalla abierta y no borres los datos de la aplicación. Usa una versión compatible antes de continuar la recuperación.",
  DIVERGENT:
    "Las copias guardadas no coinciden o se cambió esta revisión en otra pestaña. La recuperación se detuvo sin elegir una copia por ti. Conserva aquí los campos sin guardar y no borres los datos ni repitas solicitudes sin confirmar. Termina la recuperación en la pestaña que guardó correctamente por última vez.",
  REVIEW_REQUIRED:
    "Esta revisión ha superado el plazo para reintentar. Se conserva para consultar; descarta solo un borrador sin enviar para empezar de nuevo.",
  CAPACITY:
    "Esta revisión supera el límite de guardado del dispositivo. Mantén esta pantalla abierta, reduce los elementos sin enviar o el texto e intenta guardar de nuevo. Los cambios sin guardar aún deben guardarse.",
  INTENT_CHANGED:
    "La revisión guardada ya no coincide con esta acción. Mantén esta pantalla abierta y recupera el trabajo antes de continuar. No repitas una solicitud sin confirmar como un elemento nuevo.",
};
export function useReviewRecoveryText() {
  return useTranslation().locale === "es" ? es : en;
}
