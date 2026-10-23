import { useTranslation } from "@/i18n";
const en = {
  mealPlanReview: "Review meal plan",
  noRecipes: "No linked recipes were compared.",
  noGaps: "No missing ingredients found in the linked recipes compared.",
  profile: "Family profile",
  recipeReview: "Review recipe",
  unknownCoverage:
    "This comparison is incomplete. Open the recipes to review their ingredients.",
  title: "Weekly reset",
  open: "Review your week",
  intro:
    "A few minutes to make the week easier. Your review is personal; it does not complete household tasks.",
  close: "Close review",
  loading: "Loading your review…",
  loadError:
    "Your latest review could not be loaded. Saved requests are kept. Reload before making another change.",
  reload: "Reload review",
  start: "Start review",
  startHint:
    "Starting a different week replaces your previous personal review. Household plans stay as they are.",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  back: "Back",
  reviewed: "Reviewed",
  skipped: "Skipped",
  pending: "Not reviewed",
  skip: "Skip for now",
  mark: "Reviewed · continue",
  finish: "Finish review",
  final: "Review summary",
  saved: "Your review is saved",
  doneHint:
    "This records your review only. Events, chores, meals and groceries still use their normal controls.",
  restart: "Restart review",
  restartHint:
    "Clear this review's checkmarks and skips? This does not change household plans.",
  cancel: "Cancel",
  confirmRestart: "Clear review progress",
  openSection: "Open this section",
  stepError:
    "This preview could not be loaded. It is not an empty result. Retry or skip this step.",
  retryStep: "Retry preview",
  empty: "No matching records in this preview.",
  more: "This is a short preview. Open the section to see more.",
  unnamed: "Untitled meal",
  noNextPrep: "Next prep not set",
  planned: "Not prepared yet",
  prepared: "Prepared",
  recovery: "A saved request needs attention",
  recoveryHint:
    "Check the exact saved request before retrying. Closing keeps it; forgetting it does not undo any server change.",
  check: "Check saved request",
  retry: "Retry exact request",
  forget: "Forget saved request",
  forgetConfirm: "Forget this local request? Any server change will remain.",
  confirmForget: "Forget locally",
  storageError:
    "Request recovery needs attention. Nothing else will send until recovery is available.",
  repair: "Retry request storage",
  saving: "Saving…",
  readOnly: "Progress saving is paused. You can still view this review.",
  progress: (n: number, total: number) => `${n} of ${total} steps handled`,
  portions: (eaten: number, remaining: number) =>
    `${eaten} portions eaten · ${remaining} remaining`,
  plannedPortions: (n: number) => `${n} portions planned`,
  nextPrep: (date: string) => `Next prep: ${date}`,
  groceryTotal: (n: number) => `${n} open grocery items`,
  skippedCount: (n: number) => `${n} steps skipped`,
  steps: {
    schedule: "Coming schedule",
    responsibilities: "Who is doing what",
    meals: "Meals",
    prep: "Bulk prep",
    food: "Food to use soon",
    groceries: "Groceries",
  },
  groups: {
    events: "Schedule",
    chores: "Chores and routines",
    pickups: "Pickups",
    handoffs: "Sitter handoffs",
    meals: "Planned meals",
    prep: "Prep dishes",
    food: "Use soon",
    groceries: "Open groceries",
    gaps: "Recipe stock gaps",
  },
  dateKinds: { best_before: "Best before", use_by: "Use by" },
  owners: {
    you: "Assigned to you",
    assigned: "Assigned",
    unassigned: "Needs an owner",
    unknown: "Owner needs review",
  },
  notes: {
    storedScheduleOnly:
      "Stored events only. Local repeating rules and new provider changes may need review in Calendar.",
    acceptanceAndBackupUnknown:
      "Assigned does not mean accepted. Acceptance and backup are not confirmed by this preview.",
    profileChoresInChores:
      "Email-free profiles and the full routine schedule need review in the household's chore controls.",
    boundedPreview:
      "Some routine rows are unavailable in this preview. Open the section for the full review.",
    groceryGapsNotAssessed:
      "These are your open groceries. Recipe ingredient gaps have not been assessed here yet.",
    prepRequiresVerifiedEmail:
      "Verify your account email to review prep sessions.",
    storedChoresOnly:
      "Stored chores and routine occurrences only. Future definitions and paused work still use the chore controls.",
    ingredientPresenceOnly:
      "Ingredient presence for unprepared meals only, checked for the meal day or today if later. Already prepared bulk dishes are excluded. Amounts and units are not compared; these ingredients may already be on your grocery list. Review a recipe before adding anything.",
    recipeGapsIncomplete:
      "Some meals have no usable linked recipe, or this comparison reached its limit. An incomplete comparison cannot show everything you need.",
    currentFoodSnapshot:
      "Food dates are checked against today, even when reviewing another week. Follow storage and food-safety guidance.",
  },
  states: {
    ready: "The original request can be retried.",
    pending:
      "The original request may still be processing. A retry keeps its key.",
    committed: "The request was saved. Reloading current progress.",
    expired:
      "This request is too old to send. Check current progress, then forget it locally.",
    conflict:
      "Progress changed or this action is no longer available. Check current progress before forgetting it.",
    paused:
      "Saving is paused. Keep this request for later or forget it locally.",
    unavailable: "The request could not be confirmed. Keep it and check again.",
  },
};
type Copy = { [K in keyof typeof en]: (typeof en)[K] };
const es: Copy = {
  mealPlanReview: "Revisar plan de comidas",
  noRecipes: "No se compararon recetas vinculadas.",
  noGaps: "No faltan ingredientes en las recetas vinculadas comparadas.",
  profile: "Perfil familiar",
  recipeReview: "Revisar receta",
  unknownCoverage:
    "Esta comparación está incompleta. Abre las recetas para revisar sus ingredientes.",
  title: "Revisión semanal",
  open: "Revisa tu semana",
  intro:
    "Unos minutos para facilitar la semana. Tu revisión es personal; no completa tareas del hogar.",
  close: "Cerrar revisión",
  loading: "Cargando tu revisión…",
  loadError:
    "No se pudo cargar la revisión actual. Las solicitudes guardadas se conservan. Recarga antes de hacer otro cambio.",
  reload: "Recargar revisión",
  start: "Comenzar revisión",
  startHint:
    "Comenzar otra semana reemplaza tu revisión personal anterior. Los planes del hogar se conservan.",
  previousWeek: "Semana anterior",
  nextWeek: "Semana siguiente",
  back: "Atrás",
  reviewed: "Revisado",
  skipped: "Omitido",
  pending: "Sin revisar",
  skip: "Omitir por ahora",
  mark: "Revisado · continuar",
  finish: "Terminar revisión",
  final: "Resumen de la revisión",
  saved: "Tu revisión está guardada",
  doneHint:
    "Esto solo registra tu revisión. Los eventos, tareas, comidas y compras conservan sus controles habituales.",
  restart: "Reiniciar revisión",
  restartHint:
    "¿Borrar las marcas y los pasos omitidos? Esto no cambia los planes del hogar.",
  cancel: "Cancelar",
  confirmRestart: "Borrar progreso",
  openSection: "Abrir esta sección",
  stepError:
    "No se pudo cargar esta vista previa. Esto no significa que esté vacía. Reintenta u omite este paso.",
  retryStep: "Reintentar vista previa",
  empty: "No hay registros coincidentes en esta vista previa.",
  more: "Esta es una vista breve. Abre la sección para ver más.",
  unnamed: "Comida sin título",
  noNextPrep: "Próxima preparación sin fecha",
  planned: "Aún sin preparar",
  prepared: "Preparado",
  recovery: "Una solicitud guardada necesita atención",
  recoveryHint:
    "Comprueba la solicitud original antes de reintentar. Cerrar la conserva; olvidarla no deshace cambios del servidor.",
  check: "Comprobar solicitud",
  retry: "Reintentar solicitud exacta",
  forget: "Olvidar solicitud guardada",
  forgetConfirm:
    "¿Olvidar esta solicitud local? Los cambios del servidor se conservarán.",
  confirmForget: "Olvidar localmente",
  storageError:
    "La recuperación de solicitudes necesita atención. No se enviará nada más hasta recuperarla.",
  repair: "Reintentar almacenamiento",
  saving: "Guardando…",
  readOnly: "El guardado está en pausa. Aún puedes ver esta revisión.",
  progress: (n, total) => `${n} de ${total} pasos revisados u omitidos`,
  portions: (eaten, remaining) =>
    `${eaten} porciones consumidas · ${remaining} restantes`,
  plannedPortions: (n) => `${n} porciones planeadas`,
  nextPrep: (date) => `Próxima preparación: ${date}`,
  groceryTotal: (n) => `${n} productos por comprar`,
  skippedCount: (n) => `${n} pasos omitidos`,
  steps: {
    schedule: "Próximos eventos",
    responsibilities: "Quién hace qué",
    meals: "Comidas",
    prep: "Preparación por lotes",
    food: "Alimentos para usar pronto",
    groceries: "Compras",
  },
  groups: {
    events: "Agenda",
    chores: "Tareas y rutinas",
    pickups: "Recogidas",
    handoffs: "Cuidado de niños",
    meals: "Comidas planeadas",
    prep: "Platos preparados",
    food: "Usar pronto",
    groceries: "Compras pendientes",
    gaps: "Ingredientes que faltan",
  },
  dateKinds: {
    best_before: "Consumo preferente",
    use_by: "Fecha límite de consumo",
  },
  owners: {
    you: "Asignado a ti",
    assigned: "Asignado",
    unassigned: "Necesita responsable",
    unknown: "Revisar responsable",
  },
  notes: {
    storedScheduleOnly:
      "Solo eventos guardados. Revisa las repeticiones locales y los cambios del proveedor en el calendario.",
    acceptanceAndBackupUnknown:
      "Asignado no significa aceptado. Esta vista no confirma aceptación ni suplente.",
    profileChoresInChores:
      "Revisa los perfiles sin correo y el horario completo de rutinas en los controles de tareas del hogar.",
    boundedPreview:
      "Algunas tareas de rutina no están disponibles en esta vista. Abre la sección para revisarlas.",
    groceryGapsNotAssessed:
      "Estas son tus compras pendientes. Aquí aún no se han revisado los ingredientes que faltan para las recetas.",
    prepRequiresVerifiedEmail:
      "Verifica el correo de tu cuenta para revisar las preparaciones.",
    storedChoresOnly:
      "Solo tareas y rutinas guardadas. Revisa los horarios futuros y el trabajo en pausa en los controles de tareas.",
    ingredientPresenceOnly:
      "Solo se comprueba la presencia para comidas sin preparar, según el día de la comida o hoy si es posterior. Los platos por lotes ya preparados se excluyen. No se comparan cantidades ni unidades; puede que estos ingredientes ya estén en tu lista. Revisa la receta antes de añadirlos.",
    recipeGapsIncomplete:
      "Algunas comidas no tienen una receta vinculada disponible, o la comparación alcanzó su límite. Una comparación incompleta no muestra todo lo necesario.",
    currentFoodSnapshot:
      "Las fechas se comprueban según hoy, aunque revises otra semana. Sigue las indicaciones de conservación y seguridad alimentaria.",
  },
  states: {
    ready: "Puedes reintentar la solicitud original.",
    pending:
      "La solicitud original puede seguir en proceso. El reintento conserva su clave.",
    committed: "La solicitud se guardó. Recargando el progreso actual.",
    expired:
      "Esta solicitud es demasiado antigua para enviarla. Comprueba el progreso actual y luego olvídala localmente.",
    conflict:
      "El progreso cambió o la acción ya no está disponible. Comprueba el progreso actual antes de olvidarla.",
    paused:
      "El guardado está en pausa. Conserva la solicitud u olvídala localmente.",
    unavailable:
      "No se pudo confirmar la solicitud. Consérvala y vuelve a comprobarla.",
  },
};
export const weeklyResetMessages = { en, es };
export function useWeeklyResetText() {
  const { locale } = useTranslation();
  return weeklyResetMessages[locale];
}
