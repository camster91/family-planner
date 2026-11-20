"use client";

import { useCoreTranslation } from "@/i18n/core";

/** Copy for the smart Add box (#144) and the parent-only Settings switch. */
export const smartAddMessages = {
  en: {
    label: "Type what you need",
    placeholder: "e.g. 'Dentist for Casey Tue 3:30, need milk and eggs'",
    submit: "Make drafts",
    working: "Reading…",
    hint: "Nothing is added until you check it.",
    reviewTitle: "Check before adding",
    reviewHint: "Change or remove anything, then add.",
    addAll: "Add all",
    addOne: "Add",
    remove: "Remove",
    edit: "Edit",
    done: "Done",
    undo: "Undo",
    undone: "Removed what was just added.",
    undoFailed: "Some items could not be removed. Open them to remove by hand.",
    added: "Added {count}.",
    addedOne: "Added.",
    saving: "Adding…",
    saveFailed: "Could not add this. Try again.",
    offline:
      "You are offline. Your drafts are kept; add them when you are back online.",
    unclear:
      "Nothing to add was found. Try different words, or use the buttons below.",
    refused: "Smart Add can't help with that. Use the buttons below.",
    dropped: "Some parts were left out because they were unclear.",
    kindEvent: "Event",
    kindChore: "Chore",
    kindGrocery: "Grocery",
    kindMeal: "Meal",
    title: "Title",
    date: "Date",
    start: "Start",
    end: "End",
    dueDate: "Due",
    quantity: "How many",
    slot: "Meal",
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    who: "Who",
    nobody: "No one yet",
    list: "List",
    groceryListDefault: "Grocery list",
    checkWho: "Check who this is for.",
    needsTime: "Pick a start time.",
    needsAssignee: "Pick who does it.",
    parentsOnlyChores: "Only parents can add chores.",
    asGroceries: "Add as grocery items instead",
    groceryFallbackHint:
      "Smart Add isn't available. Split by commas into grocery items:",
    cancel: "Cancel",
    aiLabel: "Smart helper (AI)",
  },
  es: {
    label: "Escribe lo que necesitas",
    placeholder: "p. ej. 'Dentista para Casey mar 3:30, falta leche y huevos'",
    submit: "Crear borradores",
    working: "Leyendo…",
    hint: "No se añade nada hasta que lo revises.",
    reviewTitle: "Revisa antes de añadir",
    reviewHint: "Cambia o quita lo que quieras y luego añade.",
    addAll: "Añadir todo",
    addOne: "Añadir",
    remove: "Quitar",
    edit: "Editar",
    done: "Listo",
    undo: "Deshacer",
    undone: "Se quitó lo que acabas de añadir.",
    undoFailed:
      "No se pudieron quitar algunos elementos. Ábrelos para quitarlos a mano.",
    added: "Se añadieron {count}.",
    addedOne: "Añadido.",
    saving: "Añadiendo…",
    saveFailed: "No se pudo añadir. Inténtalo de nuevo.",
    offline:
      "No tienes conexión. Tus borradores se guardan; añádelos al volver a conectarte.",
    unclear:
      "No se encontró nada para añadir. Prueba con otras palabras o usa los botones de abajo.",
    refused:
      "Añadir inteligente no puede ayudar con eso. Usa los botones de abajo.",
    dropped: "Algunas partes se omitieron porque no estaban claras.",
    kindEvent: "Evento",
    kindChore: "Tarea",
    kindGrocery: "Compra",
    kindMeal: "Comida",
    title: "Título",
    date: "Fecha",
    start: "Inicio",
    end: "Fin",
    dueDate: "Para",
    quantity: "Cantidad",
    slot: "Comida",
    breakfast: "Desayuno",
    lunch: "Almuerzo",
    dinner: "Cena",
    snack: "Merienda",
    who: "Quién",
    nobody: "Nadie aún",
    list: "Lista",
    groceryListDefault: "Lista de compras",
    checkWho: "Revisa para quién es.",
    needsTime: "Elige una hora de inicio.",
    needsAssignee: "Elige quién lo hace.",
    parentsOnlyChores: "Solo los padres pueden añadir tareas.",
    asGroceries: "Añadir como compras",
    groceryFallbackHint:
      "Añadir inteligente no está disponible. Separa por comas en artículos de compra:",
    cancel: "Cancelar",
    aiLabel: "Ayudante inteligente (IA)",
  },
} as const;

export type SmartAddMessage = keyof typeof smartAddMessages.en;

export function useSmartAddText() {
  const { t } = useCoreTranslation();
  return (key: SmartAddMessage, params?: Record<string, string | number>) =>
    t(key, params, smartAddMessages);
}

/** Settings copy for the parent-only switch. */
export const smartHelpersSettingsMessages = {
  en: {
    title: "Smart helpers (AI)",
    description:
      "Let parents and teens type a quick note and get drafts to check.",
    toggle: "Use smart helpers",
    explain:
      "When someone types into the Add box, this app sends what they typed, today's date and time, and the names of your grocery lists to Anthropic's Claude AI. Before it leaves our server, every family member's name is replaced with a placeholder like \"Person A\", and we put the names back when the drafts come back. We never send photos of children, health, money or private messages. Nothing is added until a person checks it. Kids' accounts and the shared tablet never use smart helpers.",
    cap: "Monthly limit for your household: {cap}. Used this month: {used}.",
    off: "Off",
    on: "On",
    saveFailed: "This setting could not be saved. Try again.",
    loading: "Loading…",
  },
  es: {
    title: "Ayudantes inteligentes (IA)",
    description:
      "Permite que padres y adolescentes escriban una nota rápida y reciban borradores para revisar.",
    toggle: "Usar ayudantes inteligentes",
    explain:
      'Cuando alguien escribe en el cuadro Añadir, esta app envía lo que escribió, la fecha y hora de hoy y los nombres de tus listas de compras a la IA Claude de Anthropic. Antes de salir de nuestro servidor, el nombre de cada miembro de la familia se cambia por un marcador como "Person A", y volvemos a poner los nombres cuando llegan los borradores. Nunca enviamos fotos de niños, salud, dinero ni mensajes privados. No se añade nada hasta que una persona lo revisa. Las cuentas de niños y la tableta compartida nunca usan ayudantes inteligentes.',
    cap: "Límite mensual de tu hogar: {cap}. Usado este mes: {used}.",
    off: "Desactivado",
    on: "Activado",
    saveFailed: "No se pudo guardar este ajuste. Inténtalo de nuevo.",
    loading: "Cargando…",
  },
} as const;

export type SmartHelpersSettingsMessage =
  keyof typeof smartHelpersSettingsMessages.en;

export function useSmartHelpersSettingsText() {
  const { t } = useCoreTranslation();
  return (
    key: SmartHelpersSettingsMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, smartHelpersSettingsMessages);
}
