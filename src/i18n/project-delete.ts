/** Project-owned destructive confirmation and recovery copy. Project names stay verbatim. */
import { useTranslation } from "@/i18n";

export const projectDeleteEnglish = {
  deleteTitle: "Delete “{name}”?",
  deleteDescription:
    "This permanently deletes “{name}” and all of its tasks. This cannot be undone.",
  deleteFailed: "The project could not be deleted. Try again.",
  deleteNetworkError:
    "The project could not be deleted. Check your connection and try again.",
  deleteClose: "Close project deletion confirmation",
  deleteDeleting: "Deleting…",
} as const;

export type ProjectDeleteMessage = keyof typeof projectDeleteEnglish;

export const projectDeleteSpanish: Record<ProjectDeleteMessage, string> = {
  deleteTitle: "¿Eliminar «{name}»?",
  deleteDescription:
    "Esto eliminará permanentemente «{name}» y todas sus tareas. No se puede deshacer.",
  deleteFailed: "No se pudo eliminar el proyecto. Inténtalo de nuevo.",
  deleteNetworkError:
    "No se pudo eliminar el proyecto. Revisa tu conexión e inténtalo de nuevo.",
  deleteClose: "Cerrar confirmación para eliminar el proyecto",
  deleteDeleting: "Eliminando…",
};

export const projectDeleteMessages = {
  en: projectDeleteEnglish,
  es: projectDeleteSpanish,
};

export function useProjectDeleteText() {
  const { t: translate } = useTranslation();
  return (
    key: ProjectDeleteMessage,
    params?: Record<string, string | number>,
  ) => translate(key, params, projectDeleteMessages);
}
