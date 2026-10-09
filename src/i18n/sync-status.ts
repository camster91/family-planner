/** Visible sync presentation only. Existing clock/age/stale semantics stay in pure helpers. */
export const syncStatusEnglish = {
  justNow: "just now",
  invalid: "a while ago",
  minutes: "{count} min ago",
  hourOne: "1 hour ago",
  hourMany: "{count} hours ago",
  yesterday: "yesterday",
  days: "{count} days ago",
  updated: "Updated {age}",
  offline: "You're offline.",
  detail:
    "Showing what was here {age}. The {surface} refreshes when the connection returns.",
  stale:
    "Can't reach {brand} right now. Showing what was here {age}. The {surface} keeps trying on its own.",
  board: "board",
  calendar: "calendar",
  list: "list",
} as const;
export type SyncStatusMessage = keyof typeof syncStatusEnglish;
export const syncStatusSpanish: Record<SyncStatusMessage, string> = {
  justNow: "ahora mismo",
  invalid: "hace un tiempo",
  minutes: "hace {count} min",
  hourOne: "hace 1 hora",
  hourMany: "hace {count} horas",
  yesterday: "ayer",
  days: "hace {count} días",
  updated: "Actualizado {age}",
  offline: "Sin conexión.",
  detail:
    "Se muestra la información de {age}. El {surface} se actualiza cuando vuelve la conexión.",
  stale:
    "No se puede conectar con {brand} ahora. Se muestra la información de {age}. El {surface} sigue reintentando automáticamente.",
  board: "panel",
  calendar: "calendario",
  list: "listado",
};
export const syncStatusMessages = {
  en: syncStatusEnglish,
  es: syncStatusSpanish,
};
