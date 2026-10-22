/** Static capture-recovery controls. Titles and saved content remain verbatim. */
export const captureEnglish = {
  taskNeedsReview: "A parent needs to review this task in Chores before adding it. Your preview is kept here; no task has been added.",
  openChoreReview: "Open chore form in a new tab",
  reviewWindow: 'Showing {start}–{end} of {total}. Add includes all remaining events.',
  previousPreview: 'Previous events', nextPreview: 'Next events',
  openQuickAdd: "Open quick add",
  availabilityRetry:
    "Quick add could not connect. Try again when you have a connection.",
  quickAdd: "Quick add",
  quickAddDescription:
    "Add an event, task, or grocery item by typing or taking a photo.",
  closeQuickAdd: "Close quick add",
  quickAddPlaceholder: "dentist Tuesday 3pm, or milk",
  captureInputLabel: "What would you like to add?",
  readIt: "Read it",
  reading: "Reading…",
  choosePhoto: "Choose a photo of a flyer or timetable",
  takePhoto: "Or take a photo of a flyer",
  readingPhoto: "Reading the photo…",
  event: "Event",
  task: "Task",
  listItem: "List item",
  noDate: "no date set",
  lowConfidence: "· not sure, please check",
  adding: "Adding…",
  addIt: "Add it",
  discard: "Discard",
  noEventsFound: "No events found in that photo",
  foundOne: "Found {count} event",
  foundMany: "Found {count} events",
  removeEvent: "Remove {title}",
  addOne: "Add {count}",
  addMany: "Add {count}",
  cancel: "Cancel",
  fileReadFailed: "Could not read that file",
  imageReadFailed: "That file is not a readable image",
  imageProcessFailed: "Could not process that image",
  previewTooOld:
    "This preview is too old to retry safely. Check the app before making a new preview.",
  previewChanged:
    "This preview changed. Check the app before making a new preview.",
  uncertainSave:
    "Could not confirm whether this was saved. Try again to check the same request.",
  couldNotPrepareRetry:
    "Could not prepare a safe retry. Try again in a supported browser.",
  recoveryStorageUnavailable:
    "Saved recovery storage is unavailable. Nothing was sent. Try again when storage is available.",
  recoveryAccessUnavailable:
    "Capture recovery is unavailable until access and storage are revalidated. Nothing was sent.",
  recoveryPartialFailure:
    "Some items were added. The remaining items were not sent because capture recovery is unavailable. Revalidate access and storage before continuing.",
  retryStorage: "Retry storage",
  couldNotRead: "Could not read that",
  groceryListMissing: "Could not find a grocery list",
  groceryAddFailed: "Could not add to the list",
  couldNotSave: "Could not save",
  couldNotReadPhoto: "Could not read that photo",
  addedTitle: "Added “{title}”",
  addedOne: "Added {count} event",
  addedMany: "Added {count} events",
  addedOf: "Added {added} of {total} events",
  couldNotSaveOne:
    "{count} event could not be saved. Try again to check the same request, or check the app before removing it.",
  couldNotSaveMany:
    "{count} events could not be saved. Try again to check the same requests, or check the app before removing them.",
  couldNotSaveEvents:
    "Could not save those events. Try again to check the same requests, or check the app before making a new preview.",
  needsAttention: "Needs attention",
  previousAddHint:
    "A previous add may have completed. Check its status before making a new preview.",
  checkStatus: "Check status",
  checkStatusFor: "Check status for {title}",
  checking: "Checking…",
  retry: "Retry",
  retryFor: "Retry {title}",
  calendarEvent: "Calendar event",
  groceryItem: "Grocery item",
  statusUnavailable:
    "Status is unavailable for this saved request. Start a new preview after checking the app.",
  captureChanged: "This capture changed. Start a new preview.",
  couldNotCheck:
    "Could not check this capture. Try again when you have a connection.",
  alreadyAdded: "Already added “{title}”",
  savedRemoved:
    "This capture was saved earlier, but it is no longer present. It was not recreated.",
  savedEarlier:
    "This capture was saved earlier. Refresh the app before making a new preview.",
  stillProcessing:
    "This capture is still being processed. Check again or retry later.",
  captureTooOld:
    "This capture is too old to retry safely. Start a new preview.",
  noSavedResult: "No saved result was found. Start a new preview.",
  groceryListChanged: "The grocery list changed. Start a new preview.",
  originalProcessing:
    "The original request is still being processed. Check status before retrying.",
  couldNotSaveCapture:
    "Could not save this capture. Try again when you have a connection.",
} as const;

export type CaptureMessage = keyof typeof captureEnglish;

export const captureSpanish: Record<CaptureMessage, string> = {
  taskNeedsReview: "Un adulto debe revisar esta tarea en Tareas antes de añadirla. El borrador se conserva aquí; no se ha añadido ninguna tarea.",
  openChoreReview: "Abrir el formulario de tareas en otra pestaña",
  reviewWindow: 'Mostrando {start}–{end} de {total}. Añadir incluye todos los eventos restantes.',
  previousPreview: 'Eventos anteriores', nextPreview: 'Eventos siguientes',
  openQuickAdd: "Abrir adición rápida",
  availabilityRetry:
    "No se pudo conectar la adición rápida. Inténtalo de nuevo cuando tengas conexión.",
  quickAdd: "Adición rápida",
  quickAddDescription:
    "Añade un evento, una tarea o un artículo de supermercado escribiendo o tomando una foto.",
  closeQuickAdd: "Cerrar adición rápida",
  quickAddPlaceholder: "dentista el martes a las 3 p. m. o leche",
  captureInputLabel: "¿Qué te gustaría añadir?",
  readIt: "Leerlo",
  reading: "Leyendo…",
  choosePhoto: "Elegir una foto de un volante o horario",
  takePhoto: "O tomar una foto de un volante",
  readingPhoto: "Leyendo la foto…",
  event: "Evento",
  task: "Tarea",
  listItem: "Artículo de lista",
  noDate: "sin fecha",
  lowConfidence: "· no estamos seguros, revísalo",
  adding: "Añadiendo…",
  addIt: "Añadirlo",
  discard: "Descartar",
  noEventsFound: "No se encontraron eventos en esa foto",
  foundOne: "Se encontró {count} evento",
  foundMany: "Se encontraron {count} eventos",
  removeEvent: "Quitar {title}",
  addOne: "Añadir {count}",
  addMany: "Añadir {count}",
  cancel: "Cancelar",
  fileReadFailed: "No se pudo leer ese archivo",
  imageReadFailed: "Ese archivo no contiene una imagen legible",
  imageProcessFailed: "No se pudo procesar esa imagen",
  previewTooOld:
    "Esta vista previa es demasiado antigua para reintentarlo de forma segura. Revisa la aplicación antes de crear una vista previa nueva.",
  previewChanged:
    "Esta vista previa cambió. Revisa la aplicación antes de crear una vista previa nueva.",
  uncertainSave:
    "No se pudo confirmar si se guardó. Reintenta para consultar la misma solicitud.",
  couldNotPrepareRetry:
    "No se pudo preparar un reintento seguro. Inténtalo en un navegador compatible.",
  recoveryStorageUnavailable:
    "El almacenamiento de recuperación no está disponible. No se envió nada. Inténtalo de nuevo cuando esté disponible.",
  recoveryAccessUnavailable:
    "La recuperación de captura no está disponible hasta volver a validar el acceso y el almacenamiento. No se envió nada.",
  recoveryPartialFailure:
    "Se añadieron algunos elementos. Los restantes no se enviaron porque la recuperación de captura no está disponible. Vuelve a validar el acceso y el almacenamiento antes de continuar.",
  retryStorage: "Reintentar almacenamiento",
  couldNotRead: "No se pudo leer",
  groceryListMissing: "No se pudo encontrar una lista de supermercado",
  groceryAddFailed: "No se pudo añadir a la lista",
  couldNotSave: "No se pudo guardar",
  couldNotReadPhoto: "No se pudo leer esa foto",
  addedTitle: "Se añadió “{title}”",
  addedOne: "Se añadió {count} evento",
  addedMany: "Se añadieron {count} eventos",
  addedOf: "Se añadieron {added} de {total} eventos",
  couldNotSaveOne:
    "No se pudo guardar {count} evento. Reintenta para consultar la misma solicitud o revisa la aplicación antes de quitarlo.",
  couldNotSaveMany:
    "No se pudieron guardar {count} eventos. Reintenta para consultar las mismas solicitudes o revisa la aplicación antes de quitarlos.",
  couldNotSaveEvents:
    "No se pudieron guardar esos eventos. Reintenta para consultar las mismas solicitudes o revisa la aplicación antes de crear una vista previa nueva.",
  needsAttention: "Requiere atención",
  previousAddHint:
    "Es posible que una adición anterior se haya completado. Consulta su estado antes de crear una vista previa nueva.",
  checkStatus: "Consultar estado",
  checkStatusFor: "Consultar estado de {title}",
  checking: "Consultando…",
  retry: "Reintentar",
  retryFor: "Reintentar {title}",
  calendarEvent: "Evento del calendario",
  groceryItem: "Artículo de supermercado",
  statusUnavailable:
    "El estado no está disponible para esta solicitud guardada. Revisa la aplicación y crea una vista previa nueva.",
  captureChanged: "Esta captura cambió. Crea una vista previa nueva.",
  couldNotCheck:
    "No se pudo consultar esta captura. Reintenta cuando tengas conexión.",
  alreadyAdded: "Ya se añadió “{title}”",
  savedRemoved:
    "Esta captura se guardó antes, pero ya no está presente. No se volvió a crear.",
  savedEarlier:
    "Esta captura se guardó antes. Actualiza la aplicación antes de crear una vista previa nueva.",
  stillProcessing:
    "Esta captura todavía se está procesando. Consulta de nuevo o reintenta más tarde.",
  captureTooOld:
    "Esta captura es demasiado antigua para reintentarlo de forma segura. Crea una vista previa nueva.",
  noSavedResult:
    "No se encontró ningún resultado guardado. Crea una vista previa nueva.",
  groceryListChanged:
    "La lista de supermercado cambió. Crea una vista previa nueva.",
  originalProcessing:
    "La solicitud original todavía se está procesando. Consulta el estado antes de reintentar.",
  couldNotSaveCapture:
    "No se pudo guardar esta captura. Reintenta cuando tengas conexión.",
};

export const captureMessages = {
  en: captureEnglish,
  es: captureSpanish,
};
