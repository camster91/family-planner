/** Static assistant shell and review copy. Generated replies, names and IDs stay verbatim. */
import type { AssistantDestination } from "@/lib/assistant-actions";

export const assistantDestinationLabels: Record<
  "en" | "es",
  Record<AssistantDestination, string>
> = {
  en: {
    today: "Today",
    calendar: "Calendar",
    chores: "Chores",
    lists: "Lists",
    meals: "Meals",
    family: "Family",
    features: "Features",
    settings: "Settings",
    notes: "Notes",
    inventory: "Food inventory",
    projects: "Projects",
    budget: "Budget",
    rewards: "Rewards",
    analytics: "Analytics",
    anniversaries: "Birthdays & anniversaries",
    gamification: "Points & streaks",
    messages: "Family chat",
    wishlist: "Wishlist",
    emergency: "Emergency contacts",
    locations: "Locations",
    pickups: "Pickups & dropoffs",
    allowance: "Allowance & IOUs",
    travel: "Travel mode",
    handoff: "Babysitter handoff",
    "sick-days": "Sick days & meds",
    routines: "Routines",
    recipes: "Recipe explorer",
  },
  es: {
    today: "Hoy",
    calendar: "Calendario",
    chores: "Tareas",
    lists: "Listas",
    meals: "Comidas",
    family: "Familia",
    features: "Funciones",
    settings: "Ajustes",
    notes: "Notas",
    inventory: "Inventario de alimentos",
    projects: "Proyectos",
    budget: "Presupuesto",
    rewards: "Recompensas",
    analytics: "Análisis",
    anniversaries: "Cumpleaños y aniversarios",
    gamification: "Puntos y rachas",
    messages: "Chat familiar",
    wishlist: "Lista de deseos",
    emergency: "Contactos de emergencia",
    locations: "Ubicaciones",
    pickups: "Recogidas y entregas",
    allowance: "Mesada y deudas",
    travel: "Modo viaje",
    handoff: "Entrega a la niñera",
    "sick-days": "Días de enfermedad y medicinas",
    routines: "Rutinas",
    recipes: "Explorar recetas",
  },
};

export const assistantEnglish = {
  loading: "Opening assistant…",
  sourceEvidence: "Sources for this answer",
  sourceEvidenceExpired: "Refresh Today to check these sources again.",
  launcherReport: "Report / Suggest",
  launcherAssistant: "AI assistant",
  titleChat: "AI assistant",
  titleReport: "Report a bug or suggest a feature",
  titleReports: "My reports",
  close: "Close",
  tabAssistant: "Assistant",
  tabReport: "Report / Suggest",
  tabReports: "My reports",
  chatIntro:
    "Ask to add an event, chore, list, grocery item or note; remove an event, chore or list; or open another section. Changes need your review. Chat text goes to your household’s configured AI provider. Household records are not attached.",
  chatIntroWithToday:
    "Include Today is on: this request sends a short, read-only summary of today’s events, chores, dinner, groceries and food items marked to use soon to your household’s configured AI provider. Chat text also goes there. The summary expires shortly and never performs an action by itself.",
  includeToday: "Include Today",
  includeTodayDescription:
    "When selected, this request sends a short, read-only summary of today’s events, chores, dinner, groceries and food items marked to use soon to your household’s configured AI provider. It expires shortly and never performs an action by itself.",
  todayContextIncluded: "Today context updated at {time}.",
  todayContextExpired:
    "This Today context has expired. Refresh the preview before confirming any action.",
  refreshTodayContext: "Refresh Today context",
  todayContextUnavailable:
    "Today context is unavailable right now. Your draft is still here; try again later.",
  conversation: "Assistant conversation",
  you: "You",
  assistant: "Assistant",
  reviewProposed: "Review proposed action",
  reviewBefore: "Review before {verb}",
  removing: "removing",
  continuing: "continuing",
  titleItem: "Title / item",
  proposedTitle: "Proposed title",
  whoDoesIt: "Who does it?",
  choreAssignee: "Chore assignee",
  chooseMember: "Choose a family member…",
  emailFreeProfile: "Family profile",
  profileAssignmentDescription:
    "This is an email-free family profile. You are adding the chore as the signed-in parent.",
  assigneeChanged:
    "This family member changed or is unavailable. Reload the choices and review who does this chore.",
  profileRecurrenceUnavailable:
    "Repeating chores are paused for this profile. Choose Once or keep the draft and use Chores.",
  repeats: "Repeats",
  choreFrequency: "Chore frequency",
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  repeatOn: "Repeat on",
  weeklyHint: "Choose one or more days each week.",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
  date: "Date",
  choreDate: "Chore date",
  pointsDetails: "{points} points · {difficulty}. {guidance}",
  choreGuidance: "Use Chores for pictures, rotations and routine stacks.",
  listType: "List type: {type}",
  note: "Note",
  proposedNote: "Proposed note",
  start: "Start",
  proposedStart: "Proposed start",
  end: "End",
  proposedEnd: "Proposed end",
  eventTimeZoneLocation:
    "Times without an offset use your device’s time zone. Location: {location}",
  none: "None",
  groceryInfo:
    "Adds to your household’s grocery list when there is exactly one. Choose a list in Lists when you have several.",
  deleteTargetReviewed:
    "Current details checked. Changes before removal will require another review.",
  deleteListItemCount: "This also removes {count} list items.",
  chooseExactItem: "Choose the exact item",
  itemToRemove: "Item to remove",
  chooseItem: "Choose an item…",
  deletionInfo:
    "Deletion is permanent. Deleting a list also removes its items. Repeating chores: only the selected occurrence is removed.",
  confirmRemoving: "I confirm removing “{title}”",
  open: "Open {destination}",
  removeSelected: "Remove selected item",
  openSection: "Open section",
  confirmSave: "Confirm and save",
  cancelProposal: "Cancel proposal",
  yourMessage: "Your message",
  messagePlaceholder: "Add school pickup tomorrow at 3 for 30 minutes",
  working: "Working…",
  send: "Send",
  stopVoice: "Stop voice",
  voiceInput: "Voice input",
  clearChat: "Clear chat",
  voiceGuidance:
    "Voice uses your browser’s speech service. Review the transcript, then Send.",
  voiceUnavailable: "Voice is unavailable in this browser; typing works.",
  sessionOnly: "Chat stays only in this open app session.",
  aiSetup: "Household AI setup in Settings",
  reportIntro:
    "Save a private bug report or feature suggestion. Avoid passwords and private family details. No screenshot is attached automatically.",
  reportSaved:
    "Report saved privately. Receipt: {receipt}. Status: received, awaiting review.",
  type: "Type",
  bug: "Bug / fix",
  feature: "Feature suggestion",
  title: "Title",
  details: "What happened or what would help?",
  reportPage:
    "Page: {pathname}. Reports stay private in the app; nothing is posted publicly.",
  saving: "Saving…",
  saveReport: "Save report",
  refreshReports: "Refresh reports",
  loadingReports: "Loading reports…",
  noSavedReports: "No saved reports to show.",
  receipt: "Receipt: {id}",
  saved: "Saved “{title}”.",
  removed: "Removed “{title}”.",
  reportsLoadFailed: "Could not load your reports. Try again.",
  replyUnreadable:
    "We could not read the AI reply. Your question is still here; retry or rephrase it.",
  chatFailed: "We could not send that message. Your question is still here.",
  chatOffline:
    "No connection. Your question is still here; retry when you are online.",
  chatUnavailable:
    "Family AI is temporarily unavailable. Your question is still here; try again shortly.",
  chatRateLimited:
    "Chat limit reached. Your question is still here; try again later.",
  chatTooLong:
    "That message is too long. Your question is still here; shorten it and try again.",
  aiSetupRequired:
    "Family AI is not connected yet. Ask a parent to connect it in Settings.",
  retryChat: "Retry message",
  checkCalendar: "Check Calendar",
  checkChores: "Check Chores",
  checkLists: "Check Lists",
  checkNotes: "Check Notes",
  checkHelp: "Open Help",
  actionFailed: "Action failed. Check the app before retrying.",
  sourceChanged:
    "The source information changed or expired. Refresh Today to review this proposal again.",
  checkProposedDetails: "Check the proposed details.",
  loadChoicesFailed: "Could not load choices.",
  retryChoices: "Reload choices",
  connectionInterrupted:
    "The connection ended before confirmation. Check the app before trying this action again.",
  unreadableResponse:
    "The server response was unreadable. Check the app before trying again.",
  duplicateListTargets:
    "Some lists have identical names and details. Open Lists to review or rename them before removing a list in chat.",
  chooseChoreAssignee: "Choose who does this chore.",
  invalidChoreSchedule: "Choose a valid date or at least one weekly day.",
  chooseRemovalTarget: "Choose the exact item to remove.",
  invalidEventTime:
    "Choose a valid start and later end time. Daylight-saving gaps need another time.",
  chooseGroceryList:
    "Choose a grocery list in Lists first. Chat adds only when there is exactly one grocery list.",
  actionOpenSectionError: "Open this section to continue.",
  analytics: "Analytics",
  reportSaveFailed: "Could not save. Retry this draft.",
  voiceUnavailableError:
    "Voice is unavailable in this browser. Type your message instead.",
  voiceDenied: "Microphone access was denied. You can still type.",
  voiceNoInput: "Voice could not hear you. Try again or type.",
  voiceStartFailed: "Voice could not start. Type your message instead.",
} as const;

export type AssistantMessage = keyof typeof assistantEnglish;

export const assistantSpanish: Record<AssistantMessage, string> = {
  loading: "Abriendo asistente…",
  launcherReport: "Informar / Sugerir",
  launcherAssistant: "Asistente de IA",
  titleChat: "Asistente de IA",
  titleReport: "Informar de un error o sugerir una función",
  titleReports: "Mis informes",
  close: "Cerrar",
  tabAssistant: "Asistente",
  tabReport: "Informar / Sugerir",
  tabReports: "Mis informes",
  chatIntro:
    "Pide añadir un evento, tarea, lista, artículo de compras o nota; eliminar un evento, tarea o lista; o abrir otra sección. Los cambios requieren tu revisión. El texto del chat se envía al proveedor de IA configurado para tu hogar. No se adjuntan registros del hogar.",
  sourceEvidence: "Fuentes de esta respuesta",
  sourceEvidenceExpired: "Actualiza Hoy para volver a comprobar estas fuentes.",
  chatIntroWithToday:
    "Incluir Hoy está activado: esta solicitud envía un resumen breve y de solo lectura de los eventos, tareas, cena, compras y alimentos marcados para usar pronto al proveedor de IA configurado para tu hogar. El texto del chat también se envía allí. El resumen caduca pronto y nunca ejecuta una acción por sí solo.",
  includeToday: "Incluir Hoy",
  includeTodayDescription:
    "Al seleccionarlo, esta solicitud envía un resumen breve y de solo lectura de los eventos, tareas, cena, compras y alimentos marcados para usar pronto al proveedor de IA configurado para tu hogar. Caduca pronto y nunca ejecuta una acción por sí solo.",
  todayContextIncluded: "Contexto de Hoy actualizado a las {time}.",
  todayContextExpired:
    "Este contexto de Hoy ha caducado. Actualiza la vista previa antes de confirmar una acción.",
  refreshTodayContext: "Actualizar contexto de Hoy",
  todayContextUnavailable:
    "El contexto de Hoy no está disponible ahora. Tu borrador sigue aquí; inténtalo más tarde.",
  conversation: "Conversación con el asistente",
  you: "Tú",
  assistant: "Asistente",
  reviewProposed: "Revisar acción propuesta",
  reviewBefore: "Revisar antes de {verb}",
  removing: "eliminar",
  continuing: "continuar",
  titleItem: "Título / artículo",
  proposedTitle: "Título propuesto",
  whoDoesIt: "¿Quién lo hace?",
  choreAssignee: "Persona asignada",
  chooseMember: "Elige un miembro de la familia…",
  emailFreeProfile: "Perfil familiar",
  profileAssignmentDescription:
    "Este es un perfil familiar sin correo electrónico. Agregas la tarea como el padre o la madre que inició sesión.",
  assigneeChanged:
    "Este miembro de la familia cambió o no está disponible. Vuelve a cargar las opciones y revisa quién hará esta tarea.",
  profileRecurrenceUnavailable:
    "Las tareas repetidas están en pausa para este perfil. Elige Una vez o conserva el borrador y usa Tareas.",
  repeats: "Se repite",
  choreFrequency: "Frecuencia de la tarea",
  once: "Una vez",
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
  repeatOn: "Repetir los",
  weeklyHint: "Elige uno o más días de cada semana.",
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
  date: "Fecha",
  choreDate: "Fecha de la tarea",
  pointsDetails: "{points} puntos · {difficulty}. {guidance}",
  choreGuidance: "Usa Tareas para imágenes, turnos y rutinas encadenadas.",
  listType: "Tipo de lista: {type}",
  note: "Nota",
  proposedNote: "Nota propuesta",
  start: "Inicio",
  proposedStart: "Inicio propuesto",
  end: "Fin",
  proposedEnd: "Fin propuesto",
  eventTimeZoneLocation:
    "Las horas sin zona usan la zona horaria de tu dispositivo. Ubicación: {location}",
  none: "Ninguna",
  groceryInfo:
    "Se añade a la lista de compras del hogar cuando solo hay una. Elige una lista en Listas si hay varias.",
  deleteTargetReviewed:
    "Detalles actuales comprobados. Los cambios antes de eliminar requerirán otra revisión.",
  deleteListItemCount: "También se eliminarán {count} artículos de la lista.",
  chooseExactItem: "Elige el artículo exacto",
  itemToRemove: "Artículo que eliminar",
  chooseItem: "Elige un artículo…",
  deletionInfo:
    "La eliminación es permanente. Al eliminar una lista también se eliminan sus artículos. En las tareas repetidas solo se elimina la ocurrencia elegida.",
  confirmRemoving: "Confirmo que elimino “{title}”",
  open: "Abrir {destination}",
  removeSelected: "Eliminar artículo seleccionado",
  openSection: "Abrir sección",
  confirmSave: "Confirmar y guardar",
  cancelProposal: "Cancelar propuesta",
  yourMessage: "Tu mensaje",
  messagePlaceholder:
    "Añade recoger a alguien de la escuela mañana a las 3 durante 30 minutos",
  working: "Procesando…",
  send: "Enviar",
  stopVoice: "Detener voz",
  voiceInput: "Entrada de voz",
  clearChat: "Borrar chat",
  voiceGuidance:
    "La voz usa el servicio de voz de tu navegador. Revisa la transcripción y luego pulsa Enviar.",
  voiceUnavailable:
    "La voz no está disponible en este navegador; puedes escribir.",
  sessionOnly:
    "El chat solo permanece en esta sesión abierta de la aplicación.",
  aiSetup: "Configurar la IA del hogar en Ajustes",
  reportIntro:
    "Guarda un informe privado de error o una sugerencia. Evita contraseñas y datos familiares privados. No se adjunta ninguna captura automáticamente.",
  reportSaved:
    "Informe guardado de forma privada. Recibo: {receipt}. Estado: recibido, pendiente de revisión.",
  type: "Tipo",
  bug: "Error / corrección",
  feature: "Sugerencia de función",
  title: "Título",
  details: "¿Qué ocurrió o qué ayudaría?",
  reportPage:
    "Página: {pathname}. Los informes permanecen privados en la aplicación; no se publican.",
  saving: "Guardando…",
  saveReport: "Guardar informe",
  refreshReports: "Actualizar informes",
  loadingReports: "Cargando informes…",
  noSavedReports: "No hay informes guardados.",
  receipt: "Recibo: {id}",
  saved: "Se guardó “{title}”.",
  removed: "Se eliminó “{title}”.",
  reportsLoadFailed: "No se pudieron cargar tus informes. Inténtalo de nuevo.",
  replyUnreadable:
    "No se pudo leer la respuesta de IA. Tu pregunta sigue aquí; reintenta o reformúlala.",
  chatFailed: "No se pudo enviar el mensaje. Tu pregunta sigue aquí.",
  chatOffline:
    "No hay conexión. Tu pregunta sigue aquí; reintenta cuando vuelvas a estar conectado.",
  chatUnavailable:
    "La IA del hogar no está disponible temporalmente. Tu pregunta sigue aquí; inténtalo de nuevo en unos momentos.",
  chatRateLimited:
    "Se alcanzó el límite del chat. Tu pregunta sigue aquí; inténtalo más tarde.",
  chatTooLong:
    "Ese mensaje es demasiado largo. Tu pregunta sigue aquí; acórtalo e inténtalo de nuevo.",
  aiSetupRequired:
    "La IA del hogar aún no está conectada. Pide a un padre o madre que la conecte en Ajustes.",
  retryChat: "Reintentar mensaje",
  checkCalendar: "Revisar Calendario",
  checkChores: "Revisar Tareas",
  checkLists: "Revisar Listas",
  checkNotes: "Revisar Notas",
  checkHelp: "Abrir Ayuda",
  sourceChanged:
    "La información cambió o caducó. Actualiza Hoy para revisar esta propuesta de nuevo.",
  actionFailed:
    "La acción falló. Revisa la aplicación antes de volver a intentarlo.",
  checkProposedDetails: "Revisa los detalles propuestos.",
  loadChoicesFailed: "No se pudieron cargar las opciones.",
  retryChoices: "Volver a cargar opciones",
  connectionInterrupted:
    "La conexión terminó antes de la confirmación. Revisa la aplicación antes de volver a intentar esta acción.",
  unreadableResponse:
    "No se pudo leer la respuesta del servidor. Revisa la aplicación antes de volver a intentarlo.",
  duplicateListTargets:
    "Algunas listas tienen nombres y detalles idénticos. Abre Listas para revisarlas o cambiarles el nombre antes de eliminar una lista en el chat.",
  chooseChoreAssignee: "Elige quién hace esta tarea.",
  invalidChoreSchedule: "Elige una fecha válida o al menos un día semanal.",
  chooseRemovalTarget: "Elige el artículo exacto que quieres eliminar.",
  invalidEventTime:
    "Elige un inicio válido y una hora de finalización posterior. Los saltos por horario de verano requieren otra hora.",
  chooseGroceryList:
    "Elige primero una lista de compras en Listas. El chat solo añade artículos cuando hay exactamente una lista de compras.",
  actionOpenSectionError: "Abre esta sección para continuar.",
  analytics: "Análisis",
  reportSaveFailed: "No se pudo guardar. Intenta de nuevo este borrador.",
  voiceUnavailableError:
    "La voz no está disponible en este navegador. Escribe tu mensaje.",
  voiceDenied: "Se denegó el acceso al micrófono. Aún puedes escribir.",
  voiceNoInput: "La voz no pudo escucharte. Inténtalo de nuevo o escribe.",
  voiceStartFailed: "La voz no pudo iniciarse. Escribe tu mensaje.",
};

export const assistantMessages = {
  en: assistantEnglish,
  es: assistantSpanish,
};

export type VoiceErrorCode =
  "voiceUnavailableError" | "voiceDenied" | "voiceNoInput" | "voiceStartFailed";

export type VoiceErrorCopy = Record<VoiceErrorCode, string>;
