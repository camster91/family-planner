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
  saved: "Date saved.",
  deleted: "Date removed.",
  savedRefreshFailed:
    "Date saved. The list could not be refreshed; try again to check it.",
  deletedRefreshFailed:
    "Date removed. The list could not be refreshed; try again to check it.",
  saveUnknown: "We couldn't confirm the date was saved. Try again.",
  saveNetworkError:
    "The date could not be saved. Check your connection and try again.",
  nextUp: "Next up",
  moreDates: "More dates ({count})",
  later: "Later in the year",
  nothingSoon: "No family dates in the next 90 days.",
  annualTitle: "Every year, together",
  annual:
    "These dates repeat every year. You can update them whenever plans change.",
  householdVisibility:
    "Everyone in your household can see these dates. Only parents can remove them.",
  namePlaceholder: "e.g. Emma Johnson",
  optionalDetails: "Optional details",
  close: "Close date details",
  readOnly: "A parent or the person who added this date can edit it.",
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
  saved: "Fecha guardada.",
  deleted: "Fecha quitada.",
  savedRefreshFailed:
    "Fecha guardada. No se pudo actualizar la lista; inténtalo de nuevo para comprobarla.",
  deletedRefreshFailed:
    "Fecha quitada. No se pudo actualizar la lista; inténtalo de nuevo para comprobarla.",
  saveUnknown:
    "No pudimos confirmar que se guardó la fecha. Inténtalo de nuevo.",
  saveNetworkError:
    "No se pudo guardar la fecha. Revisa tu conexión e inténtalo de nuevo.",
  nextUp: "Próximas fechas",
  moreDates: "Más fechas ({count})",
  later: "Más adelante en el año",
  nothingSoon: "No hay fechas familiares en los próximos 90 días.",
  annualTitle: "Cada año, juntos",
  annual:
    "Estas fechas se repiten cada año. Puedes actualizarlas cuando cambien los planes.",
  householdVisibility:
    "Todos los miembros del hogar pueden ver estas fechas. Solo los padres pueden quitarlas.",
  namePlaceholder: "p. ej., Emma Johnson",
  optionalDetails: "Detalles opcionales",
  close: "Cerrar detalles de la fecha",
  readOnly: "Un padre o la persona que agregó esta fecha puede editarla.",
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
