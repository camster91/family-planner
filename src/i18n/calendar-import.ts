/** Existing import presentation; model/private text and raw server errors are parameters, never translated. */
export const calendarImportEnglish = {
  unreadable:
    "We couldn't find any dates in this. Try a clearer photo or paste the text.",
  unavailable:
    "Importing events isn't available right now. You can still add events by hand.",
  forbidden: "You can't import events. Ask a parent.",
  readFailed:
    "Something went wrong while reading this. Try again, or add the event by hand.",
  readConnection:
    "Couldn't reach the event reader. Check your connection and try again.",
  pdfLarge: "That PDF is too large. The limit is 10 MB.",
  photoLarge: "That photo is too large. The limit is 8 MB.",
  fix: "Fix the highlighted events, then add again.",
  addRetry: "Couldn't add the events. Try again; nothing will be added twice.",
  addFailed: "Couldn't add the events. Check them and try again.",
  addConnection:
    "Couldn't reach the calendar. Check your connection and try again; nothing will be added twice.",
  title: "Import events",
  close: "Close",
  intro:
    "Paste a school email or flyer, or choose a photo or PDF of it. We'll suggest the events in it, and you choose what to add.",
  from: "Import from",
  paste: "Paste text",
  file: "Photo or PDF",
  textLabel: "Text of the email or flyer",
  placeholder:
    "e.g. Picture day is next Friday. Bake sale Oct 9, 3:30–5pm in the gym.",
  find: "Find events",
  choose: "Choose a photo or PDF",
  privacy:
    "What you paste or choose is sent to our AI provider (Anthropic) to read it. It isn't saved by Family Planner.",
  reading: "Looking for events…",
  retry: "Try again",
  foundOne:
    "Found {count} event. Check it, untick anything that's wrong, then add.",
  foundMany:
    "Found {count} events. Check them, untick anything that's wrong, then add.",
  suggestions: "Suggested events",
  startOver: "Start over",
  adding: "Adding…",
  addOne: "Add {count} event",
  addMany: "Add {count} events",
  addNamed: "Add {title}",
  eventNumber: "event {number}",
  eventTitle: "Title",
  date: "Date",
  allDay: "All day",
  starts: "Starts",
  ends: "Ends (optional)",
  lastDay: "Last day (optional)",
  location: "Location",
  notes: "Notes",
  likely: "Likely",
  check: "Check this",
  unsure: "Unsure",
  enterTitle: "Enter a title.",
  titleLength: "Keep the title under 200 characters.",
  locationLength: "Keep the location under 200 characters.",
  notesLength: "Keep the notes under 1,000 characters.",
  chooseDate: "Choose a date.",
  validEndDate: "Choose a valid end date.",
  endDateBefore: "The end date is before the start date.",
  enterStart: "Enter a start time, or tick All day.",
  enterLastEnd: "Enter an end time for the last day.",
  endBefore: "The end is before the start.",
  validEndTime: "Enter a valid end time.",
} as const;
export type CalendarImportMessage = keyof typeof calendarImportEnglish;
export type CalendarImportError =
  { key: CalendarImportMessage } | { raw: string };
export const calendarImportSpanish: Record<CalendarImportMessage, string> = {
  unreadable:
    "No encontramos fechas. Prueba con una foto más clara o pega el texto.",
  unavailable:
    "La importación de eventos no está disponible ahora. Puedes añadirlos manualmente.",
  forbidden: "No puedes importar eventos. Consulta con un padre.",
  readFailed:
    "Ocurrió un error al leer. Reintenta o añade el evento manualmente.",
  readConnection:
    "No se pudo conectar con el lector de eventos. Revisa tu conexión y reintenta.",
  pdfLarge: "Ese PDF es demasiado grande. El límite es de 10 MB.",
  photoLarge: "Esa foto es demasiado grande. El límite es de 8 MB.",
  fix: "Corrige los eventos destacados y vuelve a añadirlos.",
  addRetry:
    "No se pudieron añadir los eventos. Reintenta; no se añadirán duplicados.",
  addFailed: "No se pudieron añadir los eventos. Revísalos y reintenta.",
  addConnection:
    "No se pudo conectar con el calendario. Revisa tu conexión y reintenta; no se añadirán duplicados.",
  title: "Importar eventos",
  close: "Cerrar",
  intro:
    "Pega un correo escolar o folleto, o elige una foto o PDF. Te sugeriremos los eventos y tú eliges qué añadir.",
  from: "Importar desde",
  paste: "Pegar texto",
  file: "Foto o PDF",
  textLabel: "Texto del correo o folleto",
  placeholder:
    "p. ej., Las fotos escolares son el próximo viernes. Venta de pasteles el 9 de octubre, de 15:30 a 17:00 en el gimnasio.",
  find: "Buscar eventos",
  choose: "Elegir una foto o PDF",
  privacy:
    "Lo que pegues o elijas se envía a nuestro proveedor de IA (Anthropic) para leerlo. Family Planner no lo guarda.",
  reading: "Buscando eventos…",
  retry: "Reintentar",
  foundOne:
    "Se encontró {count} evento. Revísalo, desmarca lo que esté mal y añádelo.",
  foundMany:
    "Se encontraron {count} eventos. Revísalos, desmarca lo que esté mal y añádelos.",
  suggestions: "Eventos sugeridos",
  startOver: "Empezar de nuevo",
  adding: "Añadiendo…",
  addOne: "Añadir {count} evento",
  addMany: "Añadir {count} eventos",
  addNamed: "Añadir {title}",
  eventNumber: "evento {number}",
  eventTitle: "Título",
  date: "Fecha",
  allDay: "Todo el día",
  starts: "Inicio",
  ends: "Fin (opcional)",
  lastDay: "Último día (opcional)",
  location: "Ubicación",
  notes: "Notas",
  likely: "Probable",
  check: "Revisar",
  unsure: "Incierto",
  enterTitle: "Introduce un título.",
  titleLength: "El título debe tener menos de 200 caracteres.",
  locationLength: "La ubicación debe tener menos de 200 caracteres.",
  notesLength: "Las notas deben tener menos de 1000 caracteres.",
  chooseDate: "Elige una fecha.",
  validEndDate: "Elige una fecha de fin válida.",
  endDateBefore: "La fecha de fin es anterior a la fecha de inicio.",
  enterStart: "Introduce una hora de inicio o marca Todo el día.",
  enterLastEnd: "Introduce una hora de fin para el último día.",
  endBefore: "El fin es anterior al inicio.",
  validEndTime: "Introduce una hora de fin válida.",
};
export const calendarImportMessages = {
  en: calendarImportEnglish,
  es: calendarImportSpanish,
};
