/** Preference presentation only; delivery/category policy remains canonical. */
export const notificationPreferencesEnglish = {
  choresLabel: "Chores and rewards",
  choresDescription:
    "When a chore is given to you, checked or sent back, and when rewards change.",
  eventsLabel: "Calendar events",
  eventsDescription: "Reminders about things coming up on the family calendar.",
  messagesLabel: "Family messages",
  messagesDescription: "When someone in the family sends a message.",
  summaryLabel: "Morning summary",
  summaryDescription:
    "One short note each morning with your chores, today's events and dinner. By email and in your list.",
  summaryOff: "Off unless you turn it on.",
  summaryOn: "On. Turn it off any time.",
  on: "On",
  off: "Off",
  onState: "on",
  offState: "off",
  saved: "{label}: {state}.",
  failed: 'Couldn\'t save "{label}". It is back to {state}. Try again.',
  quiet: "Quiet hours",
  quietDescription:
    "Notifications still arrive in your list, but nothing should interrupt you between these times.",
  quietFrom: "Quiet from",
  quietUntil: "Quiet until",
  saveTimes: "Save times",
  quietSavedOn: "Quiet hours: on, {start} to {end}.",
  quietSavedOff: "Quiet hours: off.",
  quietFailed:
    "Couldn't save quiet hours. They are back to {state}. Try again.",
  chooseTimes: "Choose both a start and an end time.",
  differentTimes: "The start and end times must be different.",
  zoneHint:
    "Times use this device's clock{zone}. An end time earlier than the start runs past midnight.",
  offline:
    "You're offline. You can change these again when you're back online.",
  always:
    "Some messages always arrive: password resets, email checks, household invites, and notices a parent sends you.",
  loading: "Loading your notification settings…",
  loadFailed: "Couldn't load your notification settings.",
  retry: "Try again",
} as const;
export type NotificationPreferencesMessage =
  keyof typeof notificationPreferencesEnglish;
export const notificationPreferencesSpanish: Record<
  NotificationPreferencesMessage,
  string
> = {
  choresLabel: "Tareas y recompensas",
  choresDescription:
    "Cuando te asignan, revisan o devuelven una tarea y cuando cambian las recompensas.",
  eventsLabel: "Eventos del calendario",
  eventsDescription:
    "Recordatorios de próximos eventos en el calendario familiar.",
  messagesLabel: "Mensajes de la familia",
  messagesDescription: "Cuando alguien de la familia envía un mensaje.",
  summaryLabel: "Resumen matutino",
  summaryDescription:
    "Una nota breve cada mañana con tus tareas, los eventos de hoy y la cena. Por correo y en tu lista.",
  summaryOff: "Desactivado hasta que lo actives.",
  summaryOn: "Activado. Puedes desactivarlo en cualquier momento.",
  on: "Sí",
  off: "No",
  onState: "activado",
  offState: "desactivado",
  saved: "{label}: {state}.",
  failed:
    "No se pudo guardar «{label}». Se ha restablecido a {state}. Inténtalo de nuevo.",
  quiet: "Horario de silencio",
  quietDescription:
    "Las notificaciones siguen llegando a tu lista, pero nada debería interrumpirte entre estas horas.",
  quietFrom: "Silencio desde",
  quietUntil: "Silencio hasta",
  saveTimes: "Guardar horas",
  quietSavedOn: "Horario de silencio: activado, de {start} a {end}.",
  quietSavedOff: "Horario de silencio: desactivado.",
  quietFailed:
    "No se pudo guardar el horario de silencio. Se ha restablecido a {state}. Inténtalo de nuevo.",
  chooseTimes: "Elige una hora de inicio y una de fin.",
  differentTimes: "Las horas de inicio y fin deben ser distintas.",
  zoneHint:
    "Las horas usan el reloj de este dispositivo{zone}. Si la hora de fin es anterior a la de inicio, el horario continúa después de medianoche.",
  offline:
    "Sin conexión. Podrás cambiar estos ajustes cuando vuelva la conexión.",
  always:
    "Algunos mensajes siempre llegan: restablecimientos de contraseña, verificaciones de correo, invitaciones al hogar y avisos que te envía un padre o una madre.",
  loading: "Cargando tus ajustes de notificaciones…",
  loadFailed: "No se pudieron cargar tus ajustes de notificaciones.",
  retry: "Intentar de nuevo",
};
export const notificationPreferencesMessages = {
  en: notificationPreferencesEnglish,
  es: notificationPreferencesSpanish,
};
