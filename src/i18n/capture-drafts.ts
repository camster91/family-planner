import { useTranslation } from "@/i18n";
const en = {
  restoreReplace:
    "Replace current unsaved reviewed fields with the saved review?",
  resolveConflict:
    "Choose which review to keep before leaving: restore saved work or explicitly discard the draft and unsaved edits.",
  emptyRead:
    "No events or grocery items were found. Your previous review is kept; nothing was added.",
  suggestedList: "Suggested list",
  timeHint: "Times without a time-zone offset use this device's local time.",
  replaceReview:
    "Replace this review if the new read succeeds? Failed reads keep the current reviewed fields.",
  unreadInput:
    "There is an unread phrase. Add only the reviewed items and leave that phrase?",
  uncertain:
    "Some requests could not be confirmed. Keep this exact batch and check its results.",
  lowConfidence:
    "Some source details were uncertain. Review every field before adding.",
  title: "Quick add",
  checking: "Checking saved work…",
  stopRead: "Stop reading",
  found:
    "A quick-add review is saved on this device. Restore it or discard the unsubmitted draft.",
  restore: "Restore review",
  discard: "Discard draft",
  discardConfirm:
    "Discard this unsubmitted review and unsaved changes? This cannot be undone.",
  saveHint:
    "Reviewed fields are saved on this device. Original prompts and photos are not saved.",
  saving: "Saving reviewed fields…",
  saved: "Reviewed fields saved on this device.",
  owner: "Your account or household changed. Reload before opening saved work.",
  storage:
    "Saved work could not be verified. Keep this screen open and recover saved work before continuing.",
  paused: "New changes are paused. Saved requests can still be checked.",
  expired:
    "This review is too old to submit safely. It stays available for review; only an unsubmitted draft can be discarded to start again.",
  recover: "Recover saved work",
  close: "Close and keep reviewed work",
  leaveInput:
    "Your typed phrase stays only in this screen. Leave it? Reviewed fields will be kept.",
  manualEvent: "Add event manually",
  manualGrocery: "Add groceries manually",
  manualTask: "Add chore manually",
  previous: "Previous",
  next: "Next",
  editTitle: "Title",
  start: "Starts",
  end: "Ends (optional)",
  location: "Location",
  eventType: "Event type",
  quantity: "Quantity",
  note: "Review notes",
  school: "School",
  sports: "Sports",
  appointment: "Appointment",
  family: "Family",
  work: "Work",
  other: "Other",
  unknownType: "Review event type",
  task: "Task",
  taskHint:
    "A parent must choose the assignee and schedule. Reviewing keeps this task in the batch; nothing is created until you confirm all reviewed items.",
  chore: "Review chore",
  editChore: "Chore reviewed · edit",
  reviewChore: "Use reviewed task",
  remove: "Remove from this review",
  groceryHint:
    "Grocery confirmations use your household grocery list. The suggested list name is kept with this review.",
  batchHint:
    "Confirmation includes every remaining event, reviewed chore and grocery item, including other pages.",
  confirm: "Add reviewed items",
  groceryConfirm: "Add to groceries",
  invalid:
    "Review the title, dates, quantity and event type before adding. Nothing has been submitted.",
  frozen:
    "This exact batch is saved. Fields stay locked while you check or retry the original requests.",
  check: "Check results",
  retry: "Check and add remaining items",
  finish: "Finish review",
  finishRemoved: "Finish review and keep removed items deleted",
  unknown: "Result not checked",
  absent: "No receipt yet",
  pending: "Still processing",
  present: "Saved and still present",
  removed: "Saved, then removed",
  opaque: "Saved; current item not verified",
  refused: "Access or request could not be verified",
  receiptExpired: "Receipt expired",
  legacy: "Earlier capture requests",
  legacyHint:
    "Check requests saved by the earlier capture flow in their original recovery controls. These are not copied into this review.",
  complete:
    "No saved quick-add work was found for this session on this device.",
};
const es: typeof en = {
  restoreReplace:
    "¿Reemplazar los campos sin guardar con la revisión guardada?",
  resolveConflict:
    "Elige qué conservar antes de salir: restaura lo guardado o descarta expresamente el borrador y los cambios sin guardar.",
  emptyRead:
    "No se encontraron eventos ni compras. Se conserva la revisión anterior; no se añadió nada.",
  suggestedList: "Lista sugerida",
  timeHint:
    "Las horas sin zona horaria usan la hora local de este dispositivo.",
  replaceReview:
    "¿Reemplazar esta revisión si la lectura termina bien? Si falla se conservan los campos actuales.",
  unreadInput:
    "Hay una frase sin leer. ¿Añadir solo lo revisado y dejar esa frase?",
  uncertain:
    "No se pudieron confirmar algunas solicitudes. Conserva este lote exacto y consulta sus resultados.",
  lowConfidence:
    "Algunos detalles de la fuente eran inciertos. Revisa cada campo antes de añadir.",
  title: "Añadir rápido",
  checking: "Comprobando el trabajo guardado…",
  stopRead: "Detener lectura",
  found:
    "Hay una revisión guardada en este dispositivo. Restáurala o descarta el borrador sin enviar.",
  restore: "Restaurar revisión",
  discard: "Descartar borrador",
  discardConfirm:
    "¿Descartar esta revisión sin enviar y sus cambios? No se puede deshacer.",
  saveHint:
    "Los campos revisados se guardan en este dispositivo. Las frases originales y fotos no se guardan.",
  saving: "Guardando los campos…",
  saved: "Campos revisados guardados en este dispositivo.",
  owner:
    "Tu cuenta o tu hogar cambió. Recarga antes de abrir el trabajo guardado.",
  storage:
    "No se pudo verificar el trabajo. Mantén esta pantalla abierta y recupéralo antes de continuar.",
  paused:
    "Los cambios nuevos están pausados. Puedes consultar solicitudes guardadas.",
  expired:
    "Esta revisión es demasiado antigua para enviarla con seguridad. Se conserva; solo puedes descartar un borrador sin enviar para empezar de nuevo.",
  recover: "Recuperar trabajo guardado",
  close: "Cerrar y conservar lo revisado",
  leaveInput:
    "La frase escrita solo está en esta pantalla. ¿Salir? Se conservarán los campos revisados.",
  manualEvent: "Añadir evento manualmente",
  manualGrocery: "Añadir compra manualmente",
  manualTask: "Añadir tarea manualmente",
  previous: "Anterior",
  next: "Siguiente",
  editTitle: "Título",
  start: "Empieza",
  end: "Termina (opcional)",
  location: "Lugar",
  eventType: "Tipo de evento",
  quantity: "Cantidad",
  note: "Notas de revisión",
  school: "Colegio",
  sports: "Deportes",
  appointment: "Cita",
  family: "Familia",
  work: "Trabajo",
  other: "Otro",
  unknownType: "Revisa el tipo de evento",
  task: "Tarea",
  taskHint:
    "Un adulto debe elegir la persona y el horario. Revisar conserva la tarea en el lote; no se crea hasta confirmar todos los elementos.",
  chore: "Revisar tarea",
  editChore: "Tarea revisada · editar",
  reviewChore: "Usar tarea revisada",
  remove: "Quitar de esta revisión",
  groceryHint:
    "Las compras se añaden a la lista de compra del hogar. El nombre sugerido se conserva en esta revisión.",
  batchHint:
    "La confirmación incluye todos los eventos, tareas revisadas y compras restantes, incluso otras páginas.",
  confirm: "Añadir lo revisado",
  groceryConfirm: "Añadir a la compra",
  invalid:
    "Revisa el título, las fechas, la cantidad y el tipo de evento. No se ha enviado nada.",
  frozen:
    "Este lote exacto está guardado. Los campos siguen bloqueados mientras consultas o repites las solicitudes originales.",
  check: "Consultar resultados",
  retry: "Consultar y añadir lo pendiente",
  finish: "Finalizar revisión",
  finishRemoved: "Finalizar y mantener eliminados los elementos borrados",
  unknown: "Resultado sin consultar",
  absent: "Aún no hay comprobante",
  pending: "En proceso",
  present: "Guardado y presente",
  removed: "Guardado y luego eliminado",
  opaque: "Guardado; estado actual sin verificar",
  refused: "No se pudo verificar el acceso o la solicitud",
  receiptExpired: "Comprobante caducado",
  legacy: "Solicitudes anteriores",
  legacyHint:
    "Consulta las solicitudes del flujo anterior con sus controles originales. No se copian en esta revisión.",
  complete:
    "No se encontró trabajo guardado para esta sesión en este dispositivo.",
};
export function useCaptureDraftText() {
  return useTranslation().locale === "es" ? es : en;
}
