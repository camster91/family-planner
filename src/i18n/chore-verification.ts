/** Parent-only chore verification controls and dialog copy. Chore titles and
 * server-provided failure details remain parameters/raw data and are never
 * translated. */
export const choreVerificationEnglish = {
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
("use client");

import { useTranslation } from "@/i18n";
