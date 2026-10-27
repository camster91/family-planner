"use client";

import { useTranslation } from "@/i18n";

/** Parent-only chore verification controls and dialog copy. Chore titles and
 * server-provided failure details remain parameters/raw data and are never
 * translated. */
export const choreVerificationEnglish = {
  reviewTitle: "Check chore",
  reviewDescription: "Review the current chore before verifying it or sending it back.",
  reviewLoading: "Loading current chore…",
  reviewReading: "Checking current chore…",
  reviewRead: "Check current chore",
  reviewUnavailable: "This chore cannot be reviewed right now. Check again or close this review.",
  reviewUnknown: "The result is not confirmed. Retry the original request or check the current chore.",
  reviewHeld: "The request is held. Check the current chore before deciding what to do next.",
  reviewSame: "The chore still has the original version. Your original request and notes are unchanged.",
  reviewChanged: "The chore has changed. Review the latest version before sending a new request.",
  reviewLatest: "Review latest version",
  reviewNotCompleted: "This chore is no longer waiting for a check.",
  reviewOwnerChanged: "Your account or household changed. Close this review and reload the page.",
  reviewSaved: "Your check was saved. Close this review to refresh the list.",
  reviewLeave: "Leave review",
  reviewLeaveWarning: "Leaving removes this local review and its notes. A request already sent may still be saved; leaving does not cancel it. Check the chore before trying again.",
  reviewKeep: "Keep reviewing",
  reviewNavigation: "Close this review before leaving the page.",
  reviewOriginal: "Retry original request",
  dialogTitle: "Send “{title}” back",
  dialogDescription: "Add a short note about what needs another go.",
  reasonLabel: "Reason (optional)",
  reasonPlaceholder: "What needs another go?",
  cancel: "Cancel",
  close: "Close",
  sendBack: "Send back",
  sendingBack: "Sending back…",
  tryAgain: "Try again",
  verify: "Verify",
  verifying: "Verifying…",
  verifyAriaLabel: "Verify “{title}”",
  sendBackAriaLabel: "Send back “{title}”",
  waitingForCheck: "Waiting for your check",
  verifyFailed: "Couldn't verify",
  sendBackFailed: "Couldn't send it back",
  verifiedTitle: "Chore verified",
  verifiedMessage: "“{title}” is checked.",
  sentBackTitle: "Sent back",
  sentBackMessage: "“{title}” is open again.",
} as const;

export type ChoreVerificationMessage = keyof typeof choreVerificationEnglish;

export const choreVerificationSpanish: Record<
  ChoreVerificationMessage,
  string
> = {
  reviewTitle: "Revisar tarea",
  reviewDescription: "Revisa la tarea actual antes de verificarla o devolverla.",
  reviewLoading: "Cargando la tarea actual…",
  reviewReading: "Consultando la tarea actual…",
  reviewRead: "Consultar tarea actual",
  reviewUnavailable: "No se puede revisar esta tarea ahora. Consulta de nuevo o cierra esta revisión.",
  reviewUnknown: "El resultado no está confirmado. Reintenta la solicitud original o consulta la tarea actual.",
  reviewHeld: "La solicitud está retenida. Consulta la tarea actual antes de decidir cómo continuar.",
  reviewSame: "La tarea sigue en la versión original. Tu solicitud y tus notas no han cambiado.",
  reviewChanged: "La tarea ha cambiado. Revisa la última versión antes de enviar otra solicitud.",
  reviewLatest: "Revisar última versión",
  reviewNotCompleted: "Esta tarea ya no está esperando revisión.",
  reviewOwnerChanged: "Tu cuenta o tu hogar ha cambiado. Cierra esta revisión y vuelve a cargar la página.",
  reviewSaved: "Tu revisión se guardó. Cierra esta ventana para actualizar la lista.",
  reviewLeave: "Salir de la revisión",
  reviewLeaveWarning: "Al salir se eliminan esta revisión local y sus notas. Una solicitud enviada aún puede guardarse; salir no la cancela. Consulta la tarea antes de reintentarlo.",
  reviewKeep: "Seguir revisando",
  reviewNavigation: "Cierra esta revisión antes de salir de la página.",
  reviewOriginal: "Reintentar solicitud original",
  dialogTitle: "Devolver “{title}”",
  dialogDescription:
    "Añade una nota breve sobre lo que debe intentar de nuevo.",
  reasonLabel: "Motivo (opcional)",
  reasonPlaceholder: "¿Qué debe intentar de nuevo?",
  cancel: "Cancelar",
  close: "Cerrar",
  sendBack: "Devolver",
  sendingBack: "Devolviendo…",
  tryAgain: "Intentar de nuevo",
  verify: "Verificar",
  verifying: "Verificando…",
  verifyAriaLabel: "Verificar “{title}”",
  sendBackAriaLabel: "Devolver “{title}”",
  waitingForCheck: "Esperando tu revisión",
  verifyFailed: "No se pudo verificar",
  sendBackFailed: "No se pudo devolver",
  verifiedTitle: "Tarea verificada",
  verifiedMessage: "“{title}” está revisada.",
  sentBackTitle: "Devuelta",
  sentBackMessage: "“{title}” vuelve a estar abierta.",
};

export const choreVerificationMessages = {
  en: choreVerificationEnglish,
  es: choreVerificationSpanish,
};

export function useChoreVerificationText() {
  const { t } = useTranslation();
  return (
    key: ChoreVerificationMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, choreVerificationMessages);
}
