"use client";
import { useTranslation } from "@/i18n";

export const choreOverviewEnglish = {
  openCount: "{count} to do",
  checkCount: "{count} to check",
  title: "Chores",
  add: "Add chore",
  views: "Chore views",
  today: "Today",
  week: "Week",
  series: "Series",
  all: "All chores",
  routines: "Routines",
  more: "More chore views",
  chooseMore: "More views",
  routineRange: "Routine range",
  now: "Now",
  thisWeek: "This week",
  toDo: "To do",
  routinePanel: "Routine stacks",
  noSeries: "No repeating chores to show.",
  empty: "All clear!",
  emptyToday: "No chores due today.",
  emptyRange: "No chores in this range.",
} as const;
export const choreOverviewSpanish: Record<
  keyof typeof choreOverviewEnglish,
  string
> = {
  openCount: "{count} pendientes",
  checkCount: "{count} por revisar",
  title: "Tareas",
  add: "Añadir tarea",
  views: "Vistas de tareas",
  today: "Hoy",
  week: "Semana",
  series: "Series",
  all: "Todas las tareas",
  routines: "Rutinas",
  more: "Más vistas de tareas",
  chooseMore: "Más vistas",
  routineRange: "Fechas de las rutinas",
  now: "Ahora",
  thisWeek: "Esta semana",
  toDo: "Pendientes",
  routinePanel: "Rutinas paso a paso",
  noSeries: "No hay tareas repetidas para mostrar.",
  empty: "¡Todo listo!",
  emptyToday: "No hay tareas para hoy.",
  emptyRange: "No hay tareas en estas fechas.",
};
export const choreOverviewMessages = {
  en: choreOverviewEnglish,
  es: choreOverviewSpanish,
};
export function useChoreOverviewText() {
  const { t } = useTranslation();
  return (
    key: keyof typeof choreOverviewEnglish,
    params?: Record<string, string | number>,
  ) => t(key, params, choreOverviewMessages);
}
