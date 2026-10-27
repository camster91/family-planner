import { useTranslation } from "@/i18n";

const en = {
  sections: "Assistant shortcuts",
  help: "Help",
  today: "Today",
  add: "Add",
  todayHint: "Open your current plan. These shortcuts do not read or send household records.",
  addHint: "Choose an editor, review the details, then save there. No AI provider is needed.",
  empty: "No shortcuts are available for your role and enabled features.",
  calendar: "Calendar",
  chores: "Chores",
  lists: "Lists",
  meals: "Meal plan",
  inventory: "Food inventory",
  event: "Event",
  chore: "Chore",
  list: "List",
  recipes: "Find a recipe",
  prep: "Prep session",
  notes: "Notes",
} as const;
const es: Record<keyof typeof en, string> = {
  sections: "Atajos del asistente",
  help: "Ayuda",
  today: "Hoy",
  add: "Añadir",
  todayHint: "Abre tu plan actual. Estos atajos no leen ni envían datos del hogar.",
  addHint: "Elige un editor, revisa los detalles y guarda allí. No hace falta un proveedor de IA.",
  empty: "No hay atajos disponibles para tu rol y las funciones activadas.",
  calendar: "Calendario",
  chores: "Tareas",
  lists: "Listas",
  meals: "Plan de comidas",
  inventory: "Inventario de alimentos",
  event: "Evento",
  chore: "Tarea",
  list: "Lista",
  recipes: "Buscar una receta",
  prep: "Sesión de preparación",
  notes: "Notas",
};
export type AssistantStartMessage = keyof typeof en;
export function useAssistantStartText() {
  const { t } = useTranslation();
  return (key: AssistantStartMessage) => t(key, undefined, { en, es });
}
