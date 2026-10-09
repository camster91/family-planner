import {
  accountDeletionStatusEnglish,
  accountDeletionStatusSpanish,
} from "./account-deletion-status";
/** Existing destructive contract: DELETE and private names are parameters, never translations. */
export const accountDeletionEnglish = {
  ...accountDeletionStatusEnglish,
  householdTitle: "Delete household",
  onlyParentBlocked:
    "You are the only parent in this household. Delete the household from Settings instead.",
  lastMemberBlocked:
    "You are the last member of this household. Ask a parent to delete the household instead.",
  householdWarningPrefix: "You are the only parent in ",
  householdWarningOne:
    ". Deleting it removes the household and all {count} account in it, with every chore, event, list, meal, note, photo and budget entry. Paired tablets are signed out and calendar connections are disconnected.",
  householdWarningMany:
    ". Deleting it removes the household and all {count} accounts in it, with every chore, event, list, meal, note, photo and budget entry. Paired tablets are signed out and calendar connections are disconnected.",
  invitePrefix: "To delete only your own account, first ",
  invite: "invite another parent",
  accountWarning: "This deletes your account and signs you out everywhere.",
  retainedHousehold:
    " Things you added for the household, like chores, events, lists and meals, stay with it. Your messages, notifications and your own chores are deleted.",
  irreversible: "This cannot be undone.",
  exportFirst: "Download a copy of your data first.",
  exportPreparing: "Preparing…",
  export: "Download my data",
  exportDone: "Your download has started.",
  exportFailed: "The download did not work. Try again.",
  password: "Your password",
  householdConfirmPrefix: "Type the household name, ",
  householdConfirmSuffix: ", to confirm",
  accountConfirmPrefix: "Type ",
  accountConfirmSuffix: " to confirm",
  cancel: "Cancel",
  deleting: "Deleting…",
  deleteAccount: "Delete my account",
  noConnection: "No connection. Check your connection and try again.",
  stillWorking: "Still working on it. Wait a moment, then try again.",
  sessionEnded: "Your session has ended. Sign in again to continue.",
  nothingDeleted: "Something went wrong. Nothing was deleted.",
} as const;
export type AccountDeletionMessage = keyof typeof accountDeletionEnglish;
export const accountDeletionSpanish: Record<AccountDeletionMessage, string> = {
  ...accountDeletionStatusSpanish,
  householdTitle: "Eliminar hogar",
  onlyParentBlocked:
    "Eres el único progenitor de este hogar. Elimina el hogar desde Ajustes.",
  lastMemberBlocked:
    "Eres el último miembro de este hogar. Pide a un progenitor que elimine el hogar.",
  householdWarningPrefix: "Eres el único progenitor de ",
  householdWarningOne:
    ". Al eliminarlo, se eliminan el hogar y la {count} cuenta que contiene, junto con todas las tareas, eventos, listas, comidas, notas, fotos y registros de presupuesto. Se cerrará la sesión en las tabletas vinculadas y se desconectarán las conexiones de calendario.",
  householdWarningMany:
    ". Al eliminarlo, se eliminan el hogar y las {count} cuentas que contiene, junto con todas las tareas, eventos, listas, comidas, notas, fotos y registros de presupuesto. Se cerrará la sesión en las tabletas vinculadas y se desconectarán las conexiones de calendario.",
  invitePrefix: "Para eliminar solo tu propia cuenta, primero ",
  invite: "invita a otro progenitor",
  accountWarning:
    "Esto elimina tu cuenta y cierra tu sesión en todos los dispositivos.",
  retainedHousehold:
    " Lo que añadiste para el hogar, como tareas, eventos, listas y comidas, se conserva en él. Tus mensajes, notificaciones y tus propias tareas se eliminan.",
  irreversible: "Esta acción no se puede deshacer.",
  exportFirst: "Descarga primero una copia de tus datos.",
  exportPreparing: "Preparando…",
  export: "Descargar mis datos",
  exportDone: "Tu descarga ha comenzado.",
  exportFailed: "La descarga no funcionó. Inténtalo de nuevo.",
  password: "Tu contraseña",
  householdConfirmPrefix: "Escribe el nombre del hogar, ",
  householdConfirmSuffix: ", para confirmar",
  accountConfirmPrefix: "Escribe ",
  accountConfirmSuffix: " para confirmar",
  cancel: "Cancelar",
  deleting: "Eliminando…",
  deleteAccount: "Eliminar mi cuenta",
  noConnection: "Sin conexión. Comprueba tu conexión e inténtalo de nuevo.",
  stillWorking:
    "La operación sigue en curso. Espera un momento e inténtalo de nuevo.",
  sessionEnded:
    "Tu sesión ha terminado. Inicia sesión de nuevo para continuar.",
  nothingDeleted: "Algo salió mal. No se eliminó nada.",
};
export const accountDeletionMessages = {
  en: accountDeletionEnglish,
  es: accountDeletionSpanish,
};
