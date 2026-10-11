/** Grocery recovery copy: queued is never a claim of server confirmation.
 * Item content is user-entered and must only be interpolated, never translated.
 * These keys describe display state, not persisted operation or API codes. */
export const groceryEnglish = {
  compatibleClient:
    "Pending changes need a compatible app version. Refresh or update this app. They are kept on this device and won’t be sent. Don’t add them again.",
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
  deviceConfirmed: "Item added to the grocery list.",
  deviceDropped:
    "Some older queued changes were removed. Check your grocery list before adding them again.",
  deviceValidation: "Choose a grocery list and use 1 to 200 characters.",
  actorExpired:
    "Your name selection expired. Close this form and pick your name again.",
  devicePageOnly:
    "This add is only in memory. Keep this page open until it syncs.",
  deviceQueued: "Add queued. Check its status below.",
  deviceFull:
    "Too many changes are waiting for Wi-Fi. Your text is still here; try again after they sync.",
  deviceQueueFailed:
    "Could not queue this add. Your text is still here. Try again.",
  deviceRemoved:
    "Queued add removed. Check the list before adding it again; an earlier send may already have saved it.",
  deviceRecoverFailed: "Could not update the queued add. Try again.",
  deviceTitle: "Add grocery",
  deviceQueuedSection: "Queued grocery adds",
  deviceUnconfirmedHint:
    "These items are not yet confirmed on the list. Retry here instead of adding the same item again.",
  deviceMemoryHint:
    "Changes are only in memory. Keep this page open until they sync.",
  deviceWaiting: "Waiting to add when connected.",
  deviceConflict: "That list is no longer available or has changed.",
  deviceUnsafe:
    "This add cannot safely be retried. Check the list, then remove this queued add.",
  deviceFailed: "Could not add this item.",
  deviceNoLists:
    "Create a grocery list on your personal device first. This tablet cannot create lists.",
  groceryList: "Grocery list",
  chooseList: "Choose a list",
  firstFifty:
    "Showing the first 50 lists. Use your personal device for other lists.",
  item: "Item",
  deviceOfflineHint:
    "This add will wait on this tablet and sync when connected.",
  queueing: "Queueing…",
  addItem: "Add item",
  tickAuthLost:
    "Your session ended. Saved changes were cleared. Sign in again to continue.",
  tickDiscarded:
    "Pending tick discarded. This does not undo a change already saved.",
  tickRetryRequested:
    "Retry requested. The change remains here until the server confirms it.",
  tickUpdateFailed: "Could not update the saved change. Try again.",
  tickSection: "Waiting list changes",
  tickHint:
    "Review saved ticks on this browser, even if their list or item is no longer available. Item names are not saved with ticks. Opening this view also resumes normal syncing.",
  reviewTicks: "Review waiting ticks",
  tickTitle: "Waiting ticks",
  tickDescription:
    "These are your changes on this browser. A waiting tick may belong to another list. Check your lists before discarding it.",
  ticksLoading: "Loading saved ticks…",
  ticksEmpty: "No saved ticks are waiting.",
  tickChange: "Change {index}: {action}",
  tick: "Tick an item",
  untick: "Untick an item",
  tickQueued: "Queued {date}. {state}.",
  sending: "Sending",
  failed: "Failed",
  needsReview: "Needs review",
  waitingSync: "Waiting to sync",
  retryChange: "Retry change {index}",
  discardChange: "Discard change {index}",
  retry: "Retry",
  discard: "Discard",
  discardTitle: "Discard this pending tick?",
  discardDescription:
    "This removes the saved retry from this browser. It does not undo a change already saved on the server.",
  keepTick: "Keep pending tick",
  discarding: "Discarding…",
  discardTick: "Discard pending tick",
};

export type GroceryMessage = keyof typeof groceryEnglish;
export const grocerySpanish: Record<GroceryMessage, string> = {
  compatibleClient:
    "Los cambios pendientes necesitan una versión compatible. Actualiza esta app. Se conservan en este dispositivo y no se enviarán. No los añadas de nuevo.",
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
  deviceConfirmed: "Artículo añadido a la lista de compras.",
  deviceDropped:
    "Se eliminaron algunos cambios antiguos en espera. Revisa tu lista de compras antes de añadirlos de nuevo.",
  deviceValidation:
    "Elige una lista de compras y usa entre 1 y 200 caracteres.",
  actorExpired:
    "Tu selección de nombre caducó. Cierra este formulario y vuelve a elegir tu nombre.",
  devicePageOnly:
    "Este añadido solo está en la memoria. Mantén esta página abierta hasta que se sincronice.",
  deviceQueued: "Añadido en espera. Consulta su estado abajo.",
  deviceFull:
    "Hay demasiados cambios esperando conexión Wi-Fi. Tu texto sigue aquí; inténtalo de nuevo cuando se sincronicen.",
  deviceQueueFailed:
    "No se pudo poner este añadido en espera. Tu texto sigue aquí. Inténtalo de nuevo.",
  deviceRemoved:
    "Se quitó el añadido pendiente. Revisa la lista antes de añadirlo de nuevo; un envío anterior puede haberlo guardado.",
  deviceRecoverFailed:
    "No se pudo actualizar el añadido pendiente. Inténtalo de nuevo.",
  deviceTitle: "Añadir compra",
  deviceQueuedSection: "Añadidos de compras en espera",
  deviceUnconfirmedHint:
    "Estos artículos aún no están confirmados en la lista. Reinténtalo aquí en vez de añadir el mismo artículo de nuevo.",
  deviceMemoryHint:
    "Los cambios solo están en la memoria. Mantén esta página abierta hasta que se sincronicen.",
  deviceWaiting: "En espera de añadir cuando haya conexión.",
  deviceConflict: "Esa lista ya no está disponible o ha cambiado.",
  deviceUnsafe:
    "Este añadido no se puede reintentar de forma segura. Revisa la lista y quita este añadido pendiente.",
  deviceFailed: "No se pudo añadir este artículo.",
  deviceNoLists:
    "Crea primero una lista de compras en tu dispositivo personal. Esta tableta no puede crear listas.",
  groceryList: "Lista de compras",
  chooseList: "Elige una lista",
  firstFifty:
    "Se muestran las primeras 50 listas. Usa tu dispositivo personal para otras listas.",
  item: "Artículo",
  deviceOfflineHint:
    "Este añadido quedará en espera en esta tableta y se sincronizará cuando haya conexión.",
  queueing: "Poniendo en espera…",
  addItem: "Añadir artículo",
  tickAuthLost:
    "Tu sesión terminó. Se borraron los cambios guardados. Inicia sesión de nuevo para continuar.",
  tickDiscarded:
    "Se descartó la marca pendiente. Esto no deshace un cambio ya guardado.",
  tickRetryRequested:
    "Reintento solicitado. El cambio permanece aquí hasta que el servidor lo confirme.",
  tickUpdateFailed:
    "No se pudo actualizar el cambio guardado. Inténtalo de nuevo.",
  tickSection: "Cambios de lista en espera",
  tickHint:
    "Revisa las marcas guardadas en este navegador, aunque su lista o artículo ya no esté disponible. Los nombres de los artículos no se guardan con las marcas. Abrir esta vista también reanuda la sincronización normal.",
  reviewTicks: "Revisar marcas en espera",
  tickTitle: "Marcas en espera",
  tickDescription:
    "Estos son tus cambios en este navegador. Una marca en espera puede pertenecer a otra lista. Revisa tus listas antes de descartarla.",
  ticksLoading: "Cargando marcas guardadas…",
  ticksEmpty: "No hay marcas guardadas en espera.",
  tickChange: "Cambio {index}: {action}",
  tick: "Marcar un artículo",
  untick: "Desmarcar un artículo",
  tickQueued: "En espera desde {date}. {state}.",
  sending: "Enviando",
  failed: "Falló",
  needsReview: "Necesita revisión",
  waitingSync: "En espera de sincronizar",
  retryChange: "Reintentar cambio {index}",
  discardChange: "Descartar cambio {index}",
  retry: "Reintentar",
  discard: "Descartar",
  discardTitle: "¿Descartar esta marca pendiente?",
  discardDescription:
    "Esto elimina el reintento guardado de este navegador. No deshace un cambio ya guardado en el servidor.",
  keepTick: "Conservar marca pendiente",
  discarding: "Descartando…",
  discardTick: "Descartar marca pendiente",
};
