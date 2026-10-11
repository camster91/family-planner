"use client";

import { useTranslation } from "@/i18n";

/** Visible Today/fridge-board copy. Event, member, recipe and list values stay caller-supplied. */
export const todayBoardEnglish = {
  from: "From {name}",
  until: "Until {time}",
  allDay: "All day",
  addedBy: "Added by {name}",
  today: "Today",
  openCalendar: "open calendar",
  calendarEmpty: "Nothing else on the calendar today.",
  now: "Now",
  task: "Task",
  moreLaterToday: "{count} more later today",
  recipe: "Recipe: {title}",
  prep: "Prep {duration}",
  missingIngredientOne: "1 ingredient missing",
  missingIngredientMany: "{count} ingredients missing",
  mealPlanningOff: "Meal planning is turned off for this household.",
  turnOnMealPlanning: "Turn on meal planning",
  dinnerEmpty: "No dinner planned yet.",
  planDinner: "Plan dinner",
  dinnerPlanned: "Dinner is planned",
  dinnerTonight: "Dinner tonight",
  openMeals: "open meals",
  cooking: "Cooking: {name}",
  groceries: "Groceries",
  openGroceryLists: "open grocery lists",
  groceryEmpty: "The grocery list is clear.",
  toBuy: "{count} to buy",
  moreToBuy: "{count} more to buy",
  allSharedLists: "All shared lists",
  sharedListsDescription: "To-dos, wishlists and custom lists",
  choresToday: "Chores today",
  openChores: "open chores",
  choresEmpty: "No chores due today.",
  allDoneToday: "All done for today",
  inProgress: "In progress",
  more: "{count} more",
  markDone: "Mark {title} done, {name}",
  tickOff: "Tick off {item}{quantity}",
  done: "{count} done",
  doneWaiting: "{done} done · {waiting} waiting for a parent's check",
  comingUp: "Coming up",
  tomorrow: "Tomorrow",
  comingEmpty: "Nothing on the calendar",
  dinnerLabel: "Dinner: {name}",
  planned: "planned",
  lazyAmbientLoading: "Loading the calm display",
  lazyAmbientError: "The calm display could not load.",
  lazyWeatherLoading: "Loading weather",
  lazyWeatherError: "Weather could not load.",
  retry: "Try again",
  showBoard: "Show the board",
  calmDisplay: "Calm display",
  nightDimming: "Night dimming",
  weather: "Weather",
  setupLoading: "Loading setup options",
  setupError: "Setup options could not load.",
  protocolCompatibilityTitle: "This family plan needs a refresh",
  protocolCompatibilityBody:
    "A newer family profile is waiting to be shown. Refresh to load it safely. Pending work is kept.",
  refreshBoard: "Refresh family plan",
  profilePickerTitle: "Who is this chore for?",
  profilePickerDescription: "Choose the family profile completing this chore.",
} as const;

export type TodayBoardMessage = keyof typeof todayBoardEnglish;
export type TodayBoardMessages = Record<TodayBoardMessage, string>;

export const todayBoardSpanish: TodayBoardMessages = {
  from: "De {name}",
  until: "Hasta {time}",
  allDay: "Todo el día",
  addedBy: "Añadido por {name}",
  today: "Hoy",
  openCalendar: "abrir calendario",
  calendarEmpty: "No hay nada más en el calendario hoy.",
  now: "Ahora",
  task: "Tarea",
  moreLaterToday: "{count} más hoy",
  recipe: "Receta: {title}",
  prep: "Preparación {duration}",
  missingIngredientOne: "Falta 1 ingrediente",
  missingIngredientMany: "Faltan {count} ingredientes",
  mealPlanningOff:
    "La planificación de comidas está desactivada para este hogar.",
  turnOnMealPlanning: "Activar la planificación de comidas",
  dinnerEmpty: "Aún no hay cena planificada.",
  planDinner: "Planificar cena",
  dinnerPlanned: "La cena está planificada",
  dinnerTonight: "Cena de esta noche",
  openMeals: "abrir comidas",
  cooking: "Cocina: {name}",
  groceries: "Compras",
  openGroceryLists: "abrir listas de compras",
  groceryEmpty: "La lista de compras está vacía.",
  toBuy: "{count} por comprar",
  moreToBuy: "{count} más por comprar",
  allSharedLists: "Todas las listas compartidas",
  sharedListsDescription: "Tareas, listas de deseos y listas personalizadas",
  choresToday: "Tareas de hoy",
  openChores: "abrir tareas",
  choresEmpty: "No hay tareas para hoy.",
  allDoneToday: "Todo listo por hoy",
  inProgress: "En curso",
  more: "{count} más",
  markDone: "Marcar {title} como hecha, {name}",
  tickOff: "Marcar {item}{quantity}",
  done: "{count} hechas",
  doneWaiting:
    "{done} hechas · {waiting} esperan la revisión de un padre o madre",
  comingUp: "Próximamente",
  tomorrow: "Mañana",
  comingEmpty: "No hay nada en el calendario",
  dinnerLabel: "Cena: {name}",
  planned: "planificada",
  lazyAmbientLoading: "Cargando la pantalla tranquila",
  lazyAmbientError: "No se pudo cargar la pantalla tranquila.",
  lazyWeatherLoading: "Cargando el tiempo",
  lazyWeatherError: "No se pudo cargar el tiempo.",
  retry: "Intentar de nuevo",
  showBoard: "Mostrar el panel",
  calmDisplay: "Pantalla tranquila",
  nightDimming: "Atenuación nocturna",
  weather: "Tiempo",
  setupLoading: "Cargando las opciones de configuración",
  setupError: "No se pudieron cargar las opciones de configuración.",
  protocolCompatibilityTitle: "Este plan familiar necesita actualizarse",
  protocolCompatibilityBody:
    "Hay un perfil familiar nuevo esperando para mostrarse. Actualiza para cargarlo de forma segura. El trabajo pendiente se conserva.",
  refreshBoard: "Actualizar el plan familiar",
  profilePickerTitle: "¿Para quién es esta tarea?",
  profilePickerDescription: "Elige el perfil familiar que hará esta tarea.",
};

export const todayBoardMessages = {
  en: todayBoardEnglish,
  es: todayBoardSpanish,
};

export type TodayBoardTranslator = (
  key: TodayBoardMessage,
  params?: Record<string, string | number>,
) => string;

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(params[key] ?? `{${key}}`),
  );
}

/** English fallback keeps pure board helpers and provider-free callers compatible. */
export const defaultTodayBoardText: TodayBoardTranslator = (key, params) =>
  interpolate(todayBoardEnglish[key], params);

export function useTodayBoardText(): TodayBoardTranslator {
  const { t } = useTranslation();
  return (key, params) => t(key, params, todayBoardMessages);
}
