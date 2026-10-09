/** Page/source/undo presentation; provider names and server errors remain verbatim. */
export const calendarPageEnglish = {
  import: "Import from text or photo",
  sourceTitle: "Read-only. Imported from {source}",
  source: "From {source}",
  undoFailed: "Could not undo. Try again.",
  undoConnection: "Could not undo. Check your connection and try again.",
  removedOne: "Removed {count} event",
  removedMany: "Removed {count} events",
  addedOne: "Added {count} event",
  addedMany: "Added {count} events",
  undo: "Undo",
  dismiss: "Dismiss",
} as const;
export type CalendarPageMessage = keyof typeof calendarPageEnglish;
export type CalendarPageError = { key: CalendarPageMessage } | { raw: string };
export const calendarPageSpanish: Record<CalendarPageMessage, string> = {
  import: "Importar desde texto o foto",
  sourceTitle: "Solo lectura. Importado de {source}",
  source: "De {source}",
  undoFailed: "No se pudo deshacer. Reintenta.",
  undoConnection: "No se pudo deshacer. Revisa tu conexión y reintenta.",
  removedOne: "Se eliminó {count} evento",
  removedMany: "Se eliminaron {count} eventos",
  addedOne: "Se añadió {count} evento",
  addedMany: "Se añadieron {count} eventos",
  undo: "Deshacer",
  dismiss: "Descartar",
};
export const calendarPageMessages = {
  en: calendarPageEnglish,
  es: calendarPageSpanish,
};
