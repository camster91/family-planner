/** Small eager loading presentation; destructive controls/copy stay lazy. */
export const accountDeletionStatusEnglish = {
  accountTitle: "Delete account",
  close: "Close",
  loading: "Loading…",
  loadFailed: "Could not load your account details.",
  retry: "Try again",
} as const;
export type AccountDeletionStatusMessage =
  keyof typeof accountDeletionStatusEnglish;
export const accountDeletionStatusSpanish: Record<
  AccountDeletionStatusMessage,
  string
> = {
  accountTitle: "Eliminar cuenta",
  close: "Cerrar",
  loading: "Cargando…",
  loadFailed: "No se pudieron cargar los detalles de tu cuenta.",
  retry: "Intentar de nuevo",
};
export const accountDeletionStatusMessages = {
  en: accountDeletionStatusEnglish,
  es: accountDeletionStatusSpanish,
};
