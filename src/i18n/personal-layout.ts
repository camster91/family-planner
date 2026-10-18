"use client";
import { useTranslation } from "@/i18n";
const en = {
  customize: "Customize Today",
  title: "Make Today yours",
  description:
    "Choose your sections, their order and how much space they use. This affects your personal view on this device, not the shared fridge or household features.",
  next: "Next up",
  dinner: "Dinner",
  groceries: "Groceries",
  coming: "Coming up",
  usesoon: "Use soon",
  anchor: "Always shown",
  up: "Move {section} up",
  down: "Move {section} down",
  show: "Show {section}",
  density: "Spacing",
  comfortable: "Comfortable",
  compact: "Compact",
  includeChores: "Include chores in Next up",
  calendarView: "Calendar shortcut opens",
  day: "Day",
  week: "Week",
  agenda: "Agenda",
  preview: "Preview",
  previewing: "Preview on Today",
  save: "Save layout",
  cancel: "Cancel",
  close: "Close",
  reset: "Reset layout",
  saved: "Today layout saved",
  undo: "Undo",
  storage: "Storage is unavailable. Your choice lasts for this visit.",
  previewHelp:
    "Preview is visible on Today behind this sheet. Save to keep it, or close to return to your saved view.",
  favorites: "Favorites",
  pin: "Pin {feature}",
  unpin: "Unpin {feature}",
  limit: "Choose up to 8 favorites. Unpin one to add another.",
  favoriteHelp:
    "Pinned shortcuts stay on this device. Only features you can currently use are shown.",
} as const;
const es: Record<keyof typeof en, string> = {
  customize: "Personalizar Hoy",
  title: "Haz Hoy a tu medida",
  description:
    "Elige secciones, orden y espacio. Afecta tu vista personal en este dispositivo, no la nevera compartida ni las funciones del hogar.",
  next: "A continuación",
  dinner: "Cena",
  groceries: "Compras",
  coming: "Próximamente",
  usesoon: "Usar pronto",
  anchor: "Siempre visible",
  up: "Subir {section}",
  down: "Bajar {section}",
  show: "Mostrar {section}",
  density: "Espaciado",
  comfortable: "Cómodo",
  compact: "Compacto",
  includeChores: "Incluir tareas en A continuación",
  calendarView: "El acceso al calendario abre",
  day: "Día",
  week: "Semana",
  agenda: "Agenda",
  preview: "Vista previa",
  previewing: "Vista previa en Hoy",
  save: "Guardar vista",
  cancel: "Cancelar",
  close: "Cerrar",
  reset: "Restablecer vista",
  saved: "Vista de Hoy guardada",
  undo: "Deshacer",
  storage:
    "El almacenamiento no está disponible. Tu elección dura esta visita.",
  previewHelp:
    "La vista previa aparece en Hoy detrás de este panel. Guarda para conservarla o cierra para volver a tu vista guardada.",
  favorites: "Favoritos",
  pin: "Fijar {feature}",
  unpin: "Desfijar {feature}",
  limit: "Elige hasta 8 favoritos. Desfija uno para añadir otro.",
  favoriteHelp:
    "Los accesos fijados se guardan en este dispositivo. Solo aparecen funciones que puedes usar ahora.",
};
export function usePersonalLayoutText() {
  const { locale } = useTranslation();
  return (key: keyof typeof en, params?: Record<string, string>) => {
    const value: string = (locale === "es" ? es : en)[key];
    return value.replace(
      /\{(\w+)\}/g,
      (match, name: string) => params?.[name] ?? match,
    );
  };
}
