"use client";

import { useTranslation } from "@/i18n";

/** Parent-only routine editor copy. User-authored titles and member names stay verbatim. */
export const routineStackEnglish = {
  title: "Routine",
  newTitle: "New routine",
  description: "Put several chores into one order for this occurrence.",
  occurrence: "This occurrence",
  label: "Routine name",
  labelPlaceholder: "Morning reset",
  steps: "Steps",
  candidates: "Add an existing chore",
  noCandidates: "No unstacked chores are available on this date.",
  allCandidatesAdded: "All available chores are already in this draft.",
  moreCandidates: "Load more chores",
  addExisting: "Add",
  added: "Added",
  newStep: "Create a new step",
  stepTitle: "Chore title",
  stepTitlePlaceholder: "Pack the school bag",
  assignedTo: "Assigned to",
  addStep: "Add step",
  moveUp: "Move {title} up",
  moveDown: "Move {title} down",
  remove: "Remove {title} from routine",
  existing: "Existing chore",
  drafted: "New chore",
  save: "Save routine",
  saving: "Saving routine…",
  cancel: "Cancel",
  close: "Close routine editor",
  loading: "Loading routine…",
  loadErrorTitle: "Routine could not load",
  loadError: "We couldn't load the routine choices. Try again.",
  retry: "Try again",
  saveError: "Routine could not save",
  retrySave: "Retry save",
  unknownSave:
    "We could not confirm whether the routine was saved. Keep this draft unchanged and retry.",
  conflict:
    "This routine changed elsewhere. Reload the latest copy before trying again.",
  reload: "Reload latest routine",
  discardTitle: "Discard routine changes?",
  discardDescription:
    "Your unsaved routine changes will be cleared. This cannot be undone.",
  keepEditing: "Keep editing",
  discard: "Discard changes",
  forbidden: "You do not have permission to edit this routine.",
  notFound: "This routine is no longer available.",
  invalidDraft: "Check the routine details and try again.",
  networkError:
    "Check your connection and try again. Your draft is still here.",
  oneStepRequired: "Keep at least one step in a routine.",
  assignmentRequired: "Choose a family member for the new step.",
  titleRequired: "Add a title for the new step.",
  labelRequired: "Add a name for the routine.",
  noAssignments: "No eligible family accounts are available.",
  parentOnly: "Only a parent can edit routines.",
  build: "Build a routine",
  edit: "Edit routine",
} as const;

export type RoutineStackMessage = keyof typeof routineStackEnglish;
export type RoutineStackMessages = Record<RoutineStackMessage, string>;

export const routineStackSpanish: RoutineStackMessages = {
  title: "Rutina",
  newTitle: "Nueva rutina",
  description: "Ordena varias tareas para esta ocurrencia.",
  occurrence: "Esta ocurrencia",
  label: "Nombre de la rutina",
  labelPlaceholder: "Rutina de la mañana",
  steps: "Pasos",
  candidates: "Añadir una tarea existente",
  noCandidates: "No hay tareas sin rutina disponibles para esta fecha.",
  allCandidatesAdded: "Todas las tareas disponibles ya están en este borrador.",
  moreCandidates: "Cargar más tareas",
  addExisting: "Añadir",
  added: "Añadida",
  newStep: "Crear un paso nuevo",
  stepTitle: "Título de la tarea",
  stepTitlePlaceholder: "Preparar la mochila",
  assignedTo: "Asignada a",
  addStep: "Añadir paso",
  moveUp: "Subir {title}",
  moveDown: "Bajar {title}",
  remove: "Quitar {title} de la rutina",
  existing: "Tarea existente",
  drafted: "Tarea nueva",
  save: "Guardar rutina",
  saving: "Guardando rutina…",
  cancel: "Cancelar",
  close: "Cerrar editor de rutina",
  loading: "Cargando rutina…",
  loadErrorTitle: "No se pudo cargar la rutina",
  loadError: "No se pudieron cargar las opciones. Inténtalo de nuevo.",
  retry: "Intentar de nuevo",
  saveError: "No se pudo guardar la rutina",
  retrySave: "Reintentar guardado",
  unknownSave:
    "No pudimos confirmar si se guardó la rutina. Conserva este borrador sin cambios y reintenta.",
  conflict:
    "Esta rutina cambió en otro lugar. Carga la copia más reciente antes de continuar.",
  reload: "Cargar la rutina más reciente",
  discardTitle: "¿Descartar los cambios de la rutina?",
  discardDescription:
    "Se borrarán los cambios sin guardar. Esta acción no se puede deshacer.",
  keepEditing: "Seguir editando",
  discard: "Descartar cambios",
  forbidden: "No tienes permiso para editar esta rutina.",
  notFound: "Esta rutina ya no está disponible.",
  invalidDraft: "Revisa los datos de la rutina e inténtalo de nuevo.",
  networkError:
    "Revisa tu conexión e inténtalo de nuevo. Tu borrador sigue aquí.",
  oneStepRequired: "Conserva al menos un paso en la rutina.",
  assignmentRequired: "Elige a un familiar para el paso nuevo.",
  titleRequired: "Añade un título para el paso nuevo.",
  labelRequired: "Añade un nombre para la rutina.",
  noAssignments: "No hay cuentas familiares elegibles.",
  parentOnly: "Solo un padre o madre puede editar rutinas.",
  build: "Crear una rutina",
  edit: "Editar rutina",
};

export const routineStackMessages = {
  en: routineStackEnglish,
  es: routineStackSpanish,
};

export function useRoutineStackText() {
  const { t: translate } = useTranslation();
  return (key: RoutineStackMessage, params?: Record<string, string | number>) =>
    translate(key, params, routineStackMessages);
}
