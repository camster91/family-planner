/** Anniversaries-owned destructive confirmation and recovery copy. Names stay verbatim. */
import { useTranslation } from "@/i18n";

export const anniversariesEnglish = {
  deleteTitle: "Remove “{name}”?",
  deleteDescription: "This permanently removes “{name}” from the family dates.",
  deleteFailed: "The date could not be removed. Try again.",
  deleteNetworkError:
    "The date could not be removed. Check your connection and try again.",
  deleteClose: "Close date removal confirmation",
  deleting: "Removing…",
} as const;

export type AnniversariesMessage = keyof typeof anniversariesEnglish;

export const anniversariesSpanish: Record<AnniversariesMessage, string> = {
  deleteTitle: "¿Quitar «{name}»?",
  deleteDescription:
    "Esto quitará permanentemente «{name}» de las fechas de la familia.",
  deleteFailed: "No se pudo quitar la fecha. Inténtalo de nuevo.",
  deleteNetworkError:
    "No se pudo quitar la fecha. Revisa tu conexión e inténtalo de nuevo.",
  deleteClose: "Cerrar confirmación para quitar la fecha",
  deleting: "Quitando…",
};

export const anniversariesMessages = {
  en: anniversariesEnglish,
  es: anniversariesSpanish,
};

export function useAnniversariesText() {
  const { t: translate } = useTranslation();
  return (
    key: AnniversariesMessage,
    params?: Record<string, string | number>,
  ) => translate(key, params, anniversariesMessages);
}
