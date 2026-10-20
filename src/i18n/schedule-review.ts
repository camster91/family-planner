import { useTranslation } from "@/i18n";
const en = {
  open: "Review timing",
  title: "Make room in your schedule",
  intro:
    "Compare known calendar times. An overlap does not tell us who needs to attend.",
  close: "Close timing review",
  loading: "Loading the current schedule…",
  error:
    "Could not confirm the latest schedule. Your settings and saved requests are kept.",
  reload: "Reload current event",
  changed:
    "The event changed. Review its current details before searching again.",
  ownerChanged:
    "Your account or household changed. Close and reopen this sheet before continuing.",
  untitled: "Untitled event",
  current: "Current time",
  duration: "Duration",
  zone: "Time zone",
  checked: "Schedule checked",
  find: "Find other times",
  settings: "Compare times",
  options: "Nearby options",
  preview: "Review this move",
  confirm: "Move this event",
  back: "Back",
  cancel: "Cancel",
  buffers: "Preparation and travel",
  preparation: "Preparation before",
  travelBefore: "Travel before",
  travelAfter: "Travel after",
  minutes: "min",
  hours: "h",
  seconds: "s",
  bufferHint:
    "Use these buffers for this comparison. They do not add reminders or estimate actual travel.",
  window: "Search window",
  windowHint:
    "Choose when the event could move. The full event and its buffers must fit inside a window.",
  start: "From",
  end: "Until",
  addWindow: "Add a window",
  removeWindow: "Remove this window",
  previousItem: "Previous event",
  nextItem: "Next event",
  previousWindow: "Previous window",
  nextWindow: "Next window",
  grid: "Time steps",
  draftError:
    "Check your settings: use whole minutes from 0 to 240, valid times in order, and a comparison within 45 days including the original event. Review any changed comparison buffers.",
  gap: "This local time does not exist. Choose a different time.",
  fold: "This time happens twice. Choose the offset you mean.",
  overlaps: "Possible overlaps",
  none: "No overlaps found in the records compared. This does not confirm everyone is available.",
  actual: "Event times overlap",
  bufferOnly: "Preparation or travel buffers overlap",
  more: "This is a short preview of the overlaps.",
  sources: "Calendar sources",
  sourceHint:
    "A source may be unavailable or not checked within the last 24 hours. Review connections in Calendar before relying on these options.",
  calendar: "Open calendar",
  provisional: "Provisional · coverage is incomplete",
  noOptions:
    "No opening found within your windows. Adjust the windows or buffers.",
  before: "Before",
  after: "After",
  reserved: "Including preparation and travel",
  moveHint:
    "Only this event’s times will change. Its duration stays the same. Buffers are comparison settings, and no message is sent.",
  freshHint: "Other calendar changes can introduce another overlap later.",
  readOnly: "You can review timing here. A parent must confirm changes.",
  paused:
    "Changes are paused. You can still read the plan and check saved requests.",
  otherBuffers: "Buffers for other events",
  search: "Find an event",
  searchHint: "Search the compared event titles. Only a few matches are shown.",
  removeOther: "Remove these buffers",
  reviewOther: "Use this current version",
  otherChanged:
    "This comparison event changed or is no longer in the preview. Review it or remove its buffers.",
  noMatches: "No matching events in this preview.",
  pending: "Saved moves",
  pendingHint:
    "Check an interrupted request before retrying. Closing keeps it. A past receipt does not confirm the current schedule.",
  check: "Check saved request",
  retry: "Retry exact request",
  forget: "Forget locally",
  forgetHint:
    "Forget this local request? This does not undo a move already saved on the server.",
  forgetConfirm: "Yes, forget locally",
  openSaved: "Open saved review",
  storage:
    "Saved-request storage needs attention. Recover it before sending a new change.",
  repair: "Recover saved requests",
  unknown:
    "The result is uncertain. Keep this request and check it before retrying.",
  refused:
    "The server did not confirm this request. Check it or forget it locally before making another change.",
  proof:
    "The server confirmed that request. The current event is loaded separately below.",
  holds: {
    "read-only": "This event cannot be moved from this review.",
    "repeating-target":
      "Repeating events need an explicit occurrence or series choice. Use the normal calendar controls.",
    incomplete: "Calendar coverage is incomplete.",
    "recurrence-unknown":
      "Repeating rules have not been fully expanded in this comparison.",
    "sources-unavailable":
      "Some calendar sources could not be confirmed as recent.",
    capped: "The preview reached its record or source limit.",
    "no-opening": "No matching opening was found.",
  },
  states: {
    ready: "Not recorded yet. You can retry the exact request.",
    pending: "The outcome is pending. You can retry the exact request.",
    committed: "The server has a receipt for this move.",
    expired:
      "This request is too old to retry. Read the current event before making a new proposal.",
    conflict: "The schedule changed. Do not retry this request.",
    paused: "Changes are paused. Keep this request for later review.",
    unavailable: "This request could not be checked.",
  },
  origins: {
    local: "In-app event",
    connected: "Connected calendar",
    subscribed: "Subscribed calendar · read-only",
  },
};
const es: typeof en = {
  open: "Revisar horario",
  title: "Haz espacio en tu agenda",
  intro:
    "Compara los horarios conocidos. Una coincidencia no indica quién debe asistir.",
  close: "Cerrar revisión de horario",
  loading: "Cargando la agenda actual…",
  error:
    "No se pudo confirmar la agenda actual. Tus ajustes y solicitudes guardadas se conservan.",
  reload: "Cargar el evento actual",
  changed:
    "El evento cambió. Revisa los detalles actuales antes de buscar de nuevo.",
  ownerChanged:
    "Tu cuenta u hogar cambió. Cierra y vuelve a abrir este panel antes de continuar.",
  untitled: "Evento sin título",
  current: "Horario actual",
  duration: "Duración",
  zone: "Zona horaria",
  checked: "Agenda consultada",
  find: "Buscar otros horarios",
  settings: "Comparar horarios",
  options: "Opciones cercanas",
  preview: "Revisar este cambio",
  confirm: "Mover este evento",
  back: "Atrás",
  cancel: "Cancelar",
  buffers: "Preparación y traslados",
  preparation: "Preparación previa",
  travelBefore: "Traslado previo",
  travelAfter: "Traslado posterior",
  minutes: "min",
  hours: "h",
  seconds: "s",
  bufferHint:
    "Estos márgenes se usan en esta comparación. No añaden recordatorios ni estiman el traslado real.",
  window: "Ventana de búsqueda",
  windowHint:
    "Elige cuándo podría moverse el evento. El evento completo y sus márgenes deben caber en una ventana.",
  start: "Desde",
  end: "Hasta",
  addWindow: "Añadir ventana",
  removeWindow: "Quitar esta ventana",
  previousItem: "Evento anterior",
  nextItem: "Evento siguiente",
  previousWindow: "Ventana anterior",
  nextWindow: "Ventana siguiente",
  grid: "Intervalos",
  draftError:
    "Revisa los ajustes: minutos enteros de 0 a 240, horarios válidos en orden y una comparación de hasta 45 días incluyendo el evento original. Revisa los márgenes de eventos que hayan cambiado.",
  gap: "Esta hora local no existe. Elige otra.",
  fold: "Esta hora ocurre dos veces. Elige el desfase correcto.",
  overlaps: "Posibles coincidencias",
  none: "No se encontraron coincidencias en los registros comparados. Esto no confirma que todos estén disponibles.",
  actual: "Los horarios de los eventos coinciden",
  bufferOnly: "Los márgenes de preparación o traslado coinciden",
  more: "Esta es una vista breve de las coincidencias.",
  sources: "Fuentes del calendario",
  sourceHint:
    "Una fuente puede no estar disponible o llevar más de 24 horas sin comprobarse. Revisa las conexiones antes de confiar en estas opciones.",
  calendar: "Abrir calendario",
  provisional: "Provisional · cobertura incompleta",
  noOptions:
    "No se encontró espacio en tus ventanas. Ajusta los horarios o márgenes.",
  before: "Antes",
  after: "Después",
  reserved: "Incluyendo preparación y traslados",
  moveHint:
    "Solo cambiarán los horarios de este evento. La duración se conserva. Los márgenes son ajustes de comparación y no se envía ningún mensaje.",
  freshHint:
    "Otros cambios en el calendario pueden crear nuevas coincidencias después.",
  readOnly:
    "Puedes revisar los horarios. Un padre o madre debe confirmar los cambios.",
  paused:
    "Los cambios están pausados. Puedes leer el plan y consultar solicitudes guardadas.",
  otherBuffers: "Márgenes de otros eventos",
  search: "Buscar un evento",
  searchHint:
    "Busca en los títulos comparados. Solo se muestran algunos resultados.",
  removeOther: "Quitar estos márgenes",
  reviewOther: "Usar esta versión actual",
  otherChanged:
    "Este evento cambió o ya no aparece en la vista. Revísalo o quita sus márgenes.",
  noMatches: "No hay eventos coincidentes en esta vista.",
  pending: "Cambios guardados",
  pendingHint:
    "Consulta una solicitud interrumpida antes de reintentar. Se conserva al cerrar. Un recibo anterior no confirma la agenda actual.",
  check: "Consultar solicitud guardada",
  retry: "Reintentar solicitud exacta",
  forget: "Olvidar localmente",
  forgetHint:
    "¿Olvidar esta solicitud local? No deshace un cambio ya guardado en el servidor.",
  forgetConfirm: "Sí, olvidar localmente",
  openSaved: "Abrir revisión guardada",
  storage:
    "El almacenamiento de solicitudes necesita atención. Recupéralo antes de enviar cambios.",
  repair: "Recuperar solicitudes",
  unknown:
    "El resultado es incierto. Conserva la solicitud y consúltala antes de reintentar.",
  refused:
    "El servidor no confirmó la solicitud. Consúltala u olvídala localmente antes de hacer otro cambio.",
  proof:
    "El servidor confirmó esa solicitud. El evento actual se carga por separado abajo.",
  holds: {
    "read-only": "No se puede mover este evento desde esta revisión.",
    "repeating-target":
      "Los eventos repetidos requieren elegir una aparición o la serie. Usa los controles del calendario.",
    incomplete: "La cobertura del calendario es incompleta.",
    "recurrence-unknown":
      "Las reglas de repetición no se han expandido por completo en esta comparación.",
    "sources-unavailable":
      "No se pudo confirmar que algunas fuentes sean recientes.",
    capped: "La vista alcanzó el límite de registros o fuentes.",
    "no-opening": "No se encontró un horario adecuado.",
  },
  states: {
    ready: "Aún no registrado. Puedes reintentar la solicitud exacta.",
    pending:
      "El resultado sigue pendiente. Puedes reintentar la solicitud exacta.",
    committed: "El servidor tiene un recibo de este cambio.",
    expired:
      "La solicitud es demasiado antigua. Lee el evento actual antes de proponer otro cambio.",
    conflict: "La agenda cambió. No reintentes esta solicitud.",
    paused:
      "Los cambios están pausados. Conserva esta solicitud para revisarla después.",
    unavailable: "No se pudo consultar esta solicitud.",
  },
  origins: {
    local: "Evento de la app",
    connected: "Calendario conectado",
    subscribed: "Calendario suscrito · solo lectura",
  },
};
export const scheduleReviewMessages = { en, es };
export function useScheduleReviewText() {
  return useTranslation().locale === "es" ? es : en;
}
