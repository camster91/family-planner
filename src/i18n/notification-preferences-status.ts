/** Small shared loading chunk: keep full preference copy behind its existing lazy loader. */
export const notificationPreferencesStatusEnglish = {
  loading: "Loading your notification settings…",
  loadFailed: "Couldn't load your notification settings.",
  retry: "Try again",
} as const;
export type NotificationPreferencesStatusMessage =
  keyof typeof notificationPreferencesStatusEnglish;
export const notificationPreferencesStatusSpanish: Record<
  NotificationPreferencesStatusMessage,
  string
> = {
  loading: "Cargando tus ajustes de notificaciones…",
  loadFailed: "No se pudieron cargar tus ajustes de notificaciones.",
  retry: "Intentar de nuevo",
};
export const notificationPreferencesStatusMessages = {
  en: notificationPreferencesStatusEnglish,
  es: notificationPreferencesStatusSpanish,
};
