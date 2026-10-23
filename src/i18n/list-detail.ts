"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  sortFailed:
    "Couldn’t change the sorting. Check your connection and try again.",
  moveOffline: "You’re offline. Moving an item needs a connection.",
  moveFailed: "Couldn’t move this item. Try again.",
  retry: "Retry",
  tryAgain: "Please try again.",
  connection: "Check your connection and try again.",
  restoreFailed: "Couldn't put back “{item}”",
  deleteFailed: "Couldn't delete “{item}”",
  deleted: "Deleted “{item}”",
  restored: "Restored “{item}”",
  added: "Added “{item}”",
  savedPageHint: "Saved at the end of your list. It may appear on a later page.",
  addOffline:
    "You're offline. “{item}” wasn't added. Try again when you're back online.",
  addFailed: "Couldn't add “{item}”. Check your connection and try again.",
  addReason: "Couldn't add “{item}”. {reason}",
  removed: "Removed from the list. Discard this pending change.",
  editLabel: "Edit {item}",
  edit: "Edit",
  syncOptions: "Sync options for {item}",
  retrySync: "Retry syncing {item}",
  discardLabel: "Discard change to {item}",
  discard: "Discard",
  accessChanged: "List access changed. Refresh or sign in again to continue.",
  progress: "{done} of {total} done",
  noItems: "No items yet",
  itemPages: "Item pages",
  nextItems: "Next items",
  firstItems: "Back to first items",
  pageProgress: "{done} of {total} shown items done",
  pageHint:
    "This is part of your list. Sections and progress describe shown items. New items may appear on a later page. Pending ticks remain available in recovery even when their item is not shown. Load other pages when online.",
  pageEmpty:
    "No items remain on this page. Return to the first items to see the current list.",
  readFailed:
    "We couldn’t load this list. Check pending changes in recovery and try again.",
  notFound: "List not found",
  emptyHelp: "Add items using the field below.",
  entries: "{count} entries",
  group: "{item}, {count} entries",
  addPlaceholder: "Add an item…",
  addLabel: "Add an item",
  add: "Add",
  other: "Other",
  from: "from {recipe}",
  synced: "Synced",
  waiting: "Waiting to sync",
  syncing: "Syncing…",
  expired: "Not synced: this change is too old",
  forbidden: "Not synced: you can no longer change this item",
  syncFailed: "Couldn’t sync this change",
  missing: "Not synced: this item was removed",
  conflict: "Not synced: changed elsewhere",
  recoveredReview:
    "Review this saved change before retrying. It may have been cleared in an earlier session.",
  ownerChanged:
    "Saved change paused: the account, household or session changed.",
  storageUncertain: "Saved change paused: storage could not be confirmed.",
  offlineDurable:
    "You can still tick items. Ticks are saved on this device and sync when you reconnect.",
  offlineVisit: "You can still tick items. Ticks sync when you reconnect.",
  pending: "{count} waiting to sync.",
  queueFull: "Too many changes are waiting to sync. Reconnect, then try again.",
  signedOut: "You were signed out, so changes made offline were not saved.",
  dropped: "Some changes saved on this device could not be kept.",
  notDurable:
    "Couldn’t save changes on this device. Keep this page open until they sync, or they will be lost.",
  dismiss: "Dismiss",
} as const;
const es: Record<keyof typeof en, string> = {
  itemPages: "Páginas de elementos",
  nextItems: "Siguientes elementos",
  firstItems: "Volver a los primeros elementos",
  pageProgress: "{done} de {total} elementos mostrados completados",
  pageHint:
    "Esta es una parte de tu lista. Las secciones y el progreso describen los elementos mostrados. Los nuevos pueden aparecer en otra página. Los cambios pendientes siguen disponibles en recuperación aunque su elemento no se muestre. Carga otras páginas cuando tengas conexión.",
  pageEmpty:
    "No quedan elementos en esta página. Vuelve a los primeros para ver la lista actual.",
  readFailed:
    "No se pudo cargar esta lista. Consulta los cambios pendientes en recuperación e inténtalo de nuevo.",
  notFound: "Lista no encontrada",
  sortFailed:
    "No se pudo cambiar el orden. Comprueba la conexión e inténtalo de nuevo.",
  moveOffline: "Sin conexión. Mover un artículo necesita conexión.",
  moveFailed: "No se pudo mover el artículo. Inténtalo de nuevo.",
  retry: "Reintentar",
  tryAgain: "Inténtalo de nuevo.",
  connection: "Comprueba la conexión e inténtalo de nuevo.",
  restoreFailed: "No se pudo restaurar «{item}»",
  deleteFailed: "No se pudo eliminar «{item}»",
  deleted: "Se eliminó «{item}»",
  restored: "Se restauró «{item}»",
  added: "Se añadió «{item}»",
  savedPageHint:
    "Se guardó al final de tu lista. Puede aparecer en una página posterior.",
  addOffline:
    "Sin conexión. No se añadió «{item}». Inténtalo cuando vuelvas a tener conexión.",
  addFailed:
    "No se pudo añadir «{item}». Comprueba la conexión e inténtalo de nuevo.",
  addReason: "No se pudo añadir «{item}». {reason}",
  removed: "Se eliminó de la lista. Descarta este cambio pendiente.",
  editLabel: "Editar {item}",
  edit: "Editar",
  syncOptions: "Opciones de sincronización para {item}",
  retrySync: "Reintentar sincronización de {item}",
  discardLabel: "Descartar cambio de {item}",
  discard: "Descartar",
  accessChanged:
    "Cambió el acceso a la lista. Actualiza o inicia sesión otra vez para continuar.",
  progress: "{done} de {total} completados",
  noItems: "Todavía no hay artículos",
  emptyHelp: "Añade artículos con el campo de abajo.",
  entries: "{count} entradas",
  group: "{item}, {count} entradas",
  addPlaceholder: "Añadir un artículo…",
  addLabel: "Añadir un artículo",
  add: "Añadir",
  other: "Otros",
  from: "de {recipe}",
  synced: "Sincronizado",
  waiting: "Pendiente de sincronizar",
  syncing: "Sincronizando…",
  expired: "Sin sincronizar: este cambio es demasiado antiguo",
  forbidden: "Sin sincronizar: ya no puedes cambiar este artículo",
  syncFailed: "No se pudo sincronizar el cambio",
  missing: "Sin sincronizar: se eliminó este artículo",
  conflict: "Sin sincronizar: cambió en otro lugar",
  recoveredReview:
    "Revisa este cambio guardado antes de reintentarlo. Es posible que se borrara en una sesión anterior.",
  ownerChanged:
    "Cambio guardado en pausa: cambió la cuenta, el hogar o la sesión.",
  storageUncertain:
    "Cambio guardado en pausa: no se pudo confirmar el almacenamiento.",
  offlineDurable:
    "Puedes seguir marcando artículos. Los cambios se guardan en este dispositivo y se sincronizan al recuperar la conexión.",
  offlineVisit:
    "Puedes seguir marcando artículos. Los cambios se sincronizan al recuperar la conexión.",
  pending: "{count} pendientes de sincronizar.",
  queueFull:
    "Hay demasiados cambios pendientes. Conéctate e inténtalo de nuevo.",
  signedOut:
    "Se cerró tu sesión, por lo que no se guardaron los cambios sin conexión.",
  dropped: "No se pudieron conservar algunos cambios de este dispositivo.",
  notDurable:
    "No se pudieron guardar los cambios en este dispositivo. Mantén esta página abierta hasta que se sincronicen para no perderlos.",
  dismiss: "Cerrar",
};
export type ListDetailText = (
  key: keyof typeof en,
  params?: Record<string, string | number>,
) => string;
function format(value: string, params?: Record<string, string | number>) {
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(params?.[name] ?? match),
  );
}
export const englishListDetailText: ListDetailText = (key, params) =>
  format(en[key], params);
export function useListDetailText(): ListDetailText {
  const { locale } = useTranslation();
  return useCallback(
    (key, params) => format((locale === "es" ? es : en)[key], params),
    [locale],
  );
}
