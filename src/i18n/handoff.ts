/** Handoff-owned destructive confirmation and recovery copy. Names stay verbatim. */
import { useTranslation } from "@/i18n";

export const handoffEnglish = {
  deleteTitle: "Remove “{name}”?",
  deleteDescription:
    "This permanently removes “{name}” and invalidates its shared sitter link.",
  deleteFailed: "The handoff could not be removed. Try again.",
  deleteNetworkError:
    "The handoff could not be removed. Check your connection and try again.",
  deleteClose: "Close handoff removal confirmation",
  deleting: "Removing…",
} as const;

export type HandoffMessage = keyof typeof handoffEnglish;

export const handoffSpanish: Record<HandoffMessage, string> = {
  deleteTitle: "¿Quitar «{name}»?",
  deleteDescription:
    "Esto quitará permanentemente «{name}» e invalidará su enlace compartido para la niñera.",
  deleteFailed: "No se pudo quitar la entrega. Inténtalo de nuevo.",
  deleteNetworkError:
    "No se pudo quitar la entrega. Revisa tu conexión e inténtalo de nuevo.",
  deleteClose: "Cerrar confirmación para quitar la entrega",
  deleting: "Quitando…",
};

export const handoffMessages = {
  en: handoffEnglish,
  es: handoffSpanish,
};

export function useHandoffText() {
  const { t: translate } = useTranslation();
  return (key: HandoffMessage, params?: Record<string, string | number>) =>
    translate(key, params, handoffMessages);
}
