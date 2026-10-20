"use client";
import { useTranslation } from "@/i18n";
const en = {
  pausedEdit:
    "This routine stays paused. These settings apply when it resumes.",
  afterDay: "Changes apply after {day}.",
  noResume:
    "This one-time routine has passed. Create a new routine to start again.",
  firstDay: "First scheduled day: {day}",
  continueDraft: "Continue draft",
  discardDraftTitle: "Discard this draft?",
  discardDraftHint:
    "This unsent draft will be cleared. Saved requests and existing routines stay unchanged.",
  minutes: "min",
  restore: "Keep step",
  handoff:
    "This routine has a shared schedule. Manage its future steps and controls together in Routine plans.",
  draftSaving: "Saving draft on this device…",
  draftSaved: "Draft saved on this device.",
  loadDraft: "Load the saved draft",
  loadDraftHint:
    "Replace the open unsent draft with the version saved on this device? Submitted requests and family records stay unchanged.",
  dismissDraftHint:
    "This removes the saved request and the open draft from this device. It does not undo a change that already reached your family.",
  memberRole: "Family member",
  account: "Account",
  profile: "Profile without email",
  child: "Child",
  teen: "Teen",
  parent: "Parent",
  title: "Routine plans",
  intro: "Build repeatable steps for anyone in your family.",
  open: "Manage routine plans",
  create: "New routine",
  edit: "Edit future steps",
  close: "Close",
  loading: "Loading routines…",
  retry: "Try again",
  error: "Routines could not load. Your saved requests have been kept.",
  empty: "No routine plans yet.",
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
  unsupported: "Update required",
  more: "Load more routines",
  stepsCount: "{count} steps",
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop future repeats",
  confirm: "Confirm",
  cancel: "Cancel",
  scope:
    "Changes apply after today. Started steps, photos and completed history stay.",
  stopScope:
    "Future untouched steps stop. History stays. To start again later, create a new routine.",
  resumeScope:
    "Resume from the next scheduled day after today. Missed days will not be added.",
  basics: "Routine",
  steps: "Steps",
  review: "Review",
  name: "Name",
  cue: "After… (optional)",
  cueHint:
    "For example, after breakfast. This is a habit cue, not an automatic reminder.",
  frequency: "Repeat",
  start: "Start date (optional)",
  startHint:
    "Leave empty to start today. Weekly routines follow your selected weekdays.",
  monthDay: "Day of month",
  monthHint:
    "Shorter months use their last day; later months keep your chosen day.",
  next: "Next",
  back: "Back",
  save: "Save routine",
  invalid: "Check the routine name, members, step titles and schedule.",
  step: "Step {number}",
  untitled: "Untitled step",
  addStep: "Add step",
  titleField: "What needs doing?",
  member: "Who does this step?",
  choose: "Choose a family member",
  unavailable: "Member unavailable — choose someone else",
  unavailableRepeat: "Some profiles can only receive one-time steps right now.",
  duration: "Minutes (optional)",
  details: "More step options",
  description: "Instructions (optional)",
  difficulty: "Effort",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  points: "Points",
  up: "Move {title} up",
  down: "Move {title} down",
  remove: "Remove step",
  removeScope: "Remove this future step…",
  unstack: "Keep it repeating independently",
  stopStep: "Stop its future repeats",
  removed: "Removed future steps: {count}",
  newScope:
    "Your selected schedule creates upcoming steps. Each person completes their own steps; later steps stay available.",
  draftKept:
    "Closing keeps the verified draft on this device. Unsent drafts do not change your family.",
  uncertain:
    "This save may have reached the server. Check its result before making another change.",
  saved: "Routine saved.",
  refused:
    "This save could not be confirmed. Check the saved request before making another change.",
  storage: "Saved work needs attention. Keep this page open and try recovery.",
  owner:
    "Your session changed. Return to the original account to recover its saved work.",
  recovery: "Saved requests",
  check: "Check result",
  retryOriginal: "Retry original save",
  dismiss: "Dismiss saved request",
  dismissTitle: "Dismiss this saved request?",
  dismissHint:
    "This only removes the saved copy on this device. It does not undo a change that already reached your family.",
  ready: "Ready for an original-request retry",
  pending: "Original request not yet confirmed",
  committed: "Saved successfully",
  removedResult: "Saved earlier; the routine was later removed",
  expired:
    "The original day or time has passed. Review your routines before starting a new change.",
  conflict:
    "The routine changed. Review its latest version before making a new change.",
  recoveryPaused:
    "New saves are paused. You can still check an earlier result.",
  recoveryUnavailable:
    "The original result needs review. Keep the saved request.",
  recoverStorage: "Recover saved work",
  hold: "Finish reviewing saved work before making another change.",
  noMembers: "No eligible members are available for this schedule.",
  unknownName: "Routine change",
  return: "Back to chores",
};
const es: Record<keyof typeof en, string> = {
  pausedEdit:
    "Esta rutina sigue en pausa. Los ajustes se aplican al reanudarla.",
  afterDay: "Los cambios se aplican después del {day}.",
  noResume: "Esta rutina de una vez ya pasó. Crea otra para volver a empezar.",
  firstDay: "Primer día programado: {day}",
  continueDraft: "Continuar borrador",
  discardDraftTitle: "¿Descartar este borrador?",
  discardDraftHint:
    "Se borrará este borrador sin enviar. Las solicitudes guardadas y las rutinas existentes no cambian.",
  minutes: "min",
  restore: "Conservar paso",
  handoff:
    "Esta rutina tiene un horario compartido. Gestiona sus pasos futuros y controles juntos en Planes de rutinas.",
  draftSaving: "Guardando el borrador en este dispositivo…",
  draftSaved: "Borrador guardado en este dispositivo.",
  loadDraft: "Cargar el borrador guardado",
  loadDraftHint:
    "¿Reemplazar el borrador abierto sin enviar por la versión guardada en este dispositivo? Las solicitudes enviadas y los registros familiares no cambian.",
  dismissDraftHint:
    "Se eliminan de este dispositivo la solicitud guardada y el borrador abierto. No se deshace un cambio que ya haya llegado a tu familia.",
  memberRole: "Familiar",
  account: "Cuenta",
  profile: "Perfil sin correo",
  child: "Niño/a",
  teen: "Adolescente",
  parent: "Padre o madre",
  title: "Planes de rutinas",
  intro: "Crea pasos repetibles para cualquier familiar.",
  open: "Gestionar planes de rutinas",
  create: "Nueva rutina",
  edit: "Editar pasos futuros",
  close: "Cerrar",
  loading: "Cargando rutinas…",
  retry: "Intentar de nuevo",
  error:
    "No se pudieron cargar las rutinas. Tus solicitudes guardadas se conservan.",
  empty: "Aún no hay planes de rutinas.",
  active: "Activa",
  paused: "En pausa",
  stopped: "Detenida",
  unsupported: "Actualización necesaria",
  more: "Cargar más rutinas",
  stepsCount: "{count} pasos",
  once: "Una vez",
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
  pause: "Pausar",
  resume: "Reanudar",
  stop: "Detener repeticiones futuras",
  confirm: "Confirmar",
  cancel: "Cancelar",
  scope:
    "Los cambios se aplican después de hoy. Se conservan los pasos iniciados, las fotos y el historial completado.",
  stopScope:
    "Se detienen los pasos futuros sin iniciar. Se conserva el historial. Para volver a empezar, crea una rutina nueva.",
  resumeScope:
    "Se reanuda en el próximo día programado después de hoy. No se añaden los días omitidos.",
  basics: "Rutina",
  steps: "Pasos",
  review: "Revisar",
  name: "Nombre",
  cue: "Después de… (opcional)",
  cueHint:
    "Por ejemplo, después del desayuno. Es una señal de hábito, no un recordatorio automático.",
  frequency: "Repetir",
  start: "Fecha de inicio (opcional)",
  startHint:
    "Déjala vacía para empezar hoy. Las rutinas semanales siguen los días seleccionados.",
  monthDay: "Día del mes",
  monthHint:
    "Los meses más cortos usan su último día; los demás mantienen el día elegido.",
  next: "Siguiente",
  back: "Atrás",
  save: "Guardar rutina",
  invalid: "Revisa el nombre, los familiares, los títulos y el horario.",
  step: "Paso {number}",
  untitled: "Paso sin título",
  addStep: "Añadir paso",
  titleField: "¿Qué hay que hacer?",
  member: "¿Quién hace este paso?",
  choose: "Elige un familiar",
  unavailable: "Familiar no disponible: elige otra persona",
  unavailableRepeat:
    "Por ahora, algunos perfiles solo pueden recibir pasos de una vez.",
  duration: "Minutos (opcional)",
  details: "Más opciones del paso",
  description: "Instrucciones (opcional)",
  difficulty: "Esfuerzo",
  easy: "Fácil",
  medium: "Medio",
  hard: "Difícil",
  points: "Puntos",
  up: "Subir {title}",
  down: "Bajar {title}",
  remove: "Quitar paso",
  removeScope: "Quitar este paso futuro…",
  unstack: "Mantener su repetición independiente",
  stopStep: "Detener sus repeticiones futuras",
  removed: "Pasos futuros quitados: {count}",
  newScope:
    "El horario elegido crea los próximos pasos. Cada persona completa los suyos; los pasos posteriores siguen disponibles.",
  draftKept:
    "Al cerrar se conserva el borrador verificado en este dispositivo. Los borradores sin enviar no cambian los datos familiares.",
  uncertain:
    "Este guardado puede haber llegado al servidor. Comprueba el resultado antes de hacer otro cambio.",
  saved: "Rutina guardada.",
  refused:
    "No se pudo confirmar este guardado. Comprueba la solicitud guardada antes de hacer otro cambio.",
  storage:
    "El trabajo guardado necesita atención. Mantén esta página abierta e intenta recuperarlo.",
  owner:
    "Tu sesión cambió. Vuelve a la cuenta original para recuperar su trabajo guardado.",
  recovery: "Solicitudes guardadas",
  check: "Comprobar resultado",
  retryOriginal: "Reintentar guardado original",
  dismiss: "Descartar solicitud guardada",
  dismissTitle: "¿Descartar esta solicitud guardada?",
  dismissHint:
    "Solo se elimina la copia guardada en este dispositivo. No se deshace un cambio que ya haya llegado a tu familia.",
  ready: "Lista para reintentar la solicitud original",
  pending: "Solicitud original aún sin confirmar",
  committed: "Guardada correctamente",
  removedResult: "Se guardó antes; la rutina se eliminó después",
  expired:
    "El día o la hora originales han pasado. Revisa tus rutinas antes de iniciar otro cambio.",
  conflict:
    "La rutina cambió. Revisa su versión actual antes de hacer otro cambio.",
  recoveryPaused:
    "Los guardados nuevos están en pausa. Aún puedes comprobar un resultado anterior.",
  recoveryUnavailable:
    "El resultado original necesita revisión. Conserva la solicitud guardada.",
  recoverStorage: "Recuperar trabajo guardado",
  hold: "Termina de revisar el trabajo guardado antes de hacer otro cambio.",
  noMembers: "No hay familiares elegibles para este horario.",
  unknownName: "Cambio de rutina",
  return: "Volver a tareas",
};
export const routineScheduleMessages = { en, es };
export function useRoutineScheduleText() {
  const { t } = useTranslation();
  return (key: keyof typeof en, params?: Record<string, string | number>) =>
    t(key, params, routineScheduleMessages);
}
