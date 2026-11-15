/** To-do owner and due date on list items. Presentation only. */
export const listTasksEnglish = {
  set: "Owner and due date",
  setFor: "Owner and due date for “{item}”",
  title: "Who and when",
  owner: "Who is it for?",
  ownerNone: "Anyone",
  due: "Due date (optional)",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  clear: "Clear",
  failed: "Could not save. Try again.",
  peopleFailed: "Could not load the family. Close and try again.",
  forPerson: "For {name}",
  dueToday: "Due today",
  overdue: "Overdue · {date}",
  dueOn: "Due {date}",
} as const;
export type ListTasksMessage = keyof typeof listTasksEnglish;
export const listTasksSpanish: Record<ListTasksMessage, string> = {
  set: "Responsable y fecha",
  setFor: "Responsable y fecha de “{item}”",
  title: "Quién y cuándo",
  owner: "¿Para quién es?",
  ownerNone: "Cualquiera",
  due: "Fecha límite (opcional)",
  save: "Guardar",
  saving: "Guardando…",
  cancel: "Cancelar",
  clear: "Borrar",
  failed: "No se pudo guardar. Inténtalo de nuevo.",
  peopleFailed: "No se pudo cargar la familia. Cierra e inténtalo de nuevo.",
  forPerson: "Para {name}",
  dueToday: "Vence hoy",
  overdue: "Atrasado · {date}",
  dueOn: "Vence el {date}",
};
export const listTasksMessages = { en: listTasksEnglish, es: listTasksSpanish };
