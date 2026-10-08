/** Grocery recovery copy: queued is never a claim of server confirmation.
 * Item content is user-entered and must only be interpolated, never translated.
 * These keys describe display state, not persisted operation or API codes. */
export const groceryEnglish = {
  confirmed: "Grocery add confirmed. Refreshing the list.",
  dropped:
    "Some older queued changes were removed. Check your list before adding them again.",
  personLength: "Use 1 to 500 characters.",
  loading: "The grocery queue is loading. Please try again.",
  queued: "Grocery add queued. Check its status below.",
  pageOnly:
    "Grocery add queued in this page. Keep it open until the add is confirmed.",
  full: "Too many changes are waiting. Reconnect or resolve queued changes, then try again.",
  queueFailed: "Could not queue this add. Keep the text and try again.",
  removed:
    "Queued add removed from this device. A previous send may have added it; check the list before adding it again.",
  personSection: "Grocery adds",
  placeholder: "Add an item…",
  inputLabel: "Add an item",
  add: "Add",
  signInRequired: "Sign in again before adding groceries.",
  signIn: "Sign in",
  refresh: "Refresh list",
  adding: "Adding…",
  unsafe: "Check the list before adding again; remove this queued add.",
  notFound:
    "This grocery list is no longer available. Remove this queued add or retry after checking the list.",
  unconfirmed: "Could not confirm this add. Retry or remove it.",
  waiting: "Waiting to add",
  syncOptions: "Sync options for queued add {content}",
  retryAdd: "Retry add",
  tryNow: "Try now",
  removeAdd: "Remove queued add",
  close: "Close",
  editOffline:
    "You’re offline. Connect before saving. Your draft stays here while this window is open.",
  editValidation:
    "Enter a name from 1 to 500 characters and a whole-number quantity from 1 to 9999.",
  editPrepare: "Couldn’t prepare a safe save. Keep this draft and try again.",
  editDenied:
    "You no longer have access to save this item. Close this window and sign in again.",
  editRemoved:
    "This item was removed. Refresh the list; this draft won’t add it back.",
  editConflict:
    "This item changed. Refresh the list and review the current values before saving again.",
  editUncertain:
    "We couldn’t confirm the save. Retry the same change, or close and check the list.",
  editInvalid:
    "Couldn’t save these values. Review the name and quantity, then try again.",
  editTitle: "Edit grocery item",
  editDescription: "Change the name and quantity. Saving needs a connection.",
  itemName: "Item name",
  quantity: "Quantity",
  offlineHint: "You’re offline. Connect before saving.",
  missingHint:
    "This item is no longer on the list. Close this window to continue.",
  changedHint: "This item changed. Your draft is still above.",
  currentValues: "Current list: {content} · quantity {quantity}",
  useCurrent: "Use current values",
  saving: "Saving…",
  retrySave: "Retry save",
  saveChanges: "Save changes",
  closeCheck: "Close and check list",
  cancel: "Cancel",
};

export type GroceryMessage = keyof typeof groceryEnglish;
export const grocerySpanish: Record<GroceryMessage, string> = {
  confirmed: "Añadido confirmado. Actualizando la lista.",
  dropped:
    "Se eliminaron algunos cambios antiguos en espera. Revisa tu lista antes de añadirlos de nuevo.",
  personLength: "Usa entre 1 y 500 caracteres.",
  loading: "Se está cargando la cola de compras. Inténtalo de nuevo.",
  queued: "Añadido en espera. Consulta su estado abajo.",
  pageOnly:
    "Añadido en espera en esta página. Mantenla abierta hasta que se confirme.",
  full: "Hay demasiados cambios en espera. Vuelve a conectarte o resuelve los cambios pendientes e inténtalo de nuevo.",
  queueFailed:
    "No se pudo poner este añadido en espera. Conserva el texto e inténtalo de nuevo.",
  removed:
    "Se quitó el añadido pendiente de este dispositivo. Un envío anterior puede haberlo añadido; revisa la lista antes de añadirlo de nuevo.",
  personSection: "Añadidos de compras",
  placeholder: "Añade un artículo…",
  inputLabel: "Añade un artículo",
  add: "Añadir",
  signInRequired: "Inicia sesión de nuevo antes de añadir compras.",
  signIn: "Iniciar sesión",
  refresh: "Actualizar lista",
  adding: "Añadiendo…",
  unsafe:
    "Revisa la lista antes de añadirlo de nuevo; quita este añadido pendiente.",
  notFound:
    "Esta lista de compras ya no está disponible. Quita este añadido pendiente o vuelve a intentarlo tras revisar la lista.",
  unconfirmed: "No se pudo confirmar este añadido. Reinténtalo o quítalo.",
  waiting: "En espera de añadir",
  syncOptions: "Opciones de sincronización para el añadido pendiente {content}",
  retryAdd: "Reintentar añadido",
  tryNow: "Intentar ahora",
  removeAdd: "Quitar añadido pendiente",
  close: "Cerrar",
  editOffline:
    "No tienes conexión. Conéctate antes de guardar. Tu borrador permanece aquí mientras esta ventana esté abierta.",
  editValidation:
    "Introduce un nombre de entre 1 y 500 caracteres y una cantidad entera de entre 1 y 9999.",
  editPrepare:
    "No se pudo preparar un guardado seguro. Conserva este borrador e inténtalo de nuevo.",
  editDenied:
    "Ya no tienes acceso para guardar este artículo. Cierra esta ventana e inicia sesión de nuevo.",
  editRemoved:
    "Se eliminó este artículo. Actualiza la lista; este borrador no lo volverá a añadir.",
  editConflict:
    "Este artículo cambió. Actualiza la lista y revisa los valores actuales antes de volver a guardar.",
  editUncertain:
    "No se pudo confirmar el guardado. Reintenta el mismo cambio o cierra y revisa la lista.",
  editInvalid:
    "No se pudieron guardar estos valores. Revisa el nombre y la cantidad e inténtalo de nuevo.",
  editTitle: "Editar artículo de compras",
  editDescription:
    "Cambia el nombre y la cantidad. Para guardar necesitas conexión.",
  itemName: "Nombre del artículo",
  quantity: "Cantidad",
  offlineHint: "No tienes conexión. Conéctate antes de guardar.",
  missingHint:
    "Este artículo ya no está en la lista. Cierra esta ventana para continuar.",
  changedHint: "Este artículo cambió. Tu borrador sigue arriba.",
  currentValues: "Lista actual: {content} · cantidad {quantity}",
  useCurrent: "Usar valores actuales",
  saving: "Guardando…",
  retrySave: "Reintentar guardado",
  saveChanges: "Guardar cambios",
  closeCheck: "Cerrar y revisar lista",
  cancel: "Cancelar",
};
